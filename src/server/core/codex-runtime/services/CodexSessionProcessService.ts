import { Context, Data, Effect, Layer, Ref } from "effect";
import { ulid } from "ulid";
import type { ParsedCodexLine } from "../../../../lib/codex-conversation-schema/parseCodexJsonl";
import type { PublicSessionProcess } from "../../../../types/session-process";
import { EventBus } from "../../events/services/EventBus";
import { SessionIndexService } from "../../session/infrastructure/SessionIndexService";
import type { CodexTurnOptionsSchema, UserMessageInputSchema } from "../schema";
import { CodexRpcClientService } from "./CodexRpcClientService";

type CodexProcessState = PublicSessionProcess["status"];

type CodexSessionProcessRecord = {
  id: string;
  projectId: string;
  sessionId: string;
  cwd: string;
  status: CodexProcessState;
  lastTurnId: string | null;
  createdAt: number;
  updatedAt: number;
};

let sharedProcessesRef: Ref.Ref<Map<string, CodexSessionProcessRecord>> | null =
  null;

const getSharedProcessesRef = (): Effect.Effect<
  Ref.Ref<Map<string, CodexSessionProcessRecord>>
> =>
  Effect.gen(function* () {
    if (sharedProcessesRef !== null) {
      return sharedProcessesRef;
    }

    const created = yield* Ref.make(
      new Map<string, CodexSessionProcessRecord>(),
    );
    sharedProcessesRef = created;
    return created;
  });

class SessionProcessNotFoundError extends Data.TaggedError(
  "SessionProcessNotFoundError",
)<{
  sessionProcessId: string;
}> {}

interface CodexSessionProcessServiceInterface {
  readonly startSessionProcess: (options: {
    projectId: string;
    cwd: string;
    input: UserMessageInputSchema;
    baseSession:
      | undefined
      | { type: "fork"; sessionId: string }
      | { type: "resume"; sessionId: string };
    turnOptions?: CodexTurnOptionsSchema;
  }) => Effect.Effect<{ sessionProcess: PublicSessionProcess }, unknown>;
  readonly continueSessionProcess: (options: {
    sessionProcessId: string;
    baseSessionId: string;
    input: UserMessageInputSchema;
    turnOptions?: CodexTurnOptionsSchema;
  }) => Effect.Effect<{ sessionProcess: PublicSessionProcess }, unknown>;
  readonly abortSessionProcess: (
    sessionProcessId: string,
  ) => Effect.Effect<void, unknown>;
  readonly getSessionProcesses: () => Effect.Effect<PublicSessionProcess[]>;
  readonly getSessionProcess: (
    sessionProcessId: string,
  ) => Effect.Effect<CodexSessionProcessRecord, SessionProcessNotFoundError>;
  readonly handleRpcNotification: (notification: {
    method: string;
    params?: unknown;
  }) => Effect.Effect<void, unknown>;
  readonly setAwaitingApproval: (
    sessionId: string,
  ) => Effect.Effect<CodexSessionProcessRecord | null, unknown>;
  readonly resumeAfterApproval: (
    sessionId: string,
  ) => Effect.Effect<CodexSessionProcessRecord | null, unknown>;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const getStringField = (value: unknown, key: string): string | null => {
  if (!isRecord(value)) {
    return null;
  }

  const field = value[key];
  return typeof field === "string" ? field : null;
};

const getRecordField = (
  value: unknown,
  key: string,
): Record<string, unknown> | null => {
  if (!isRecord(value)) {
    return null;
  }

  const field = value[key];
  return isRecord(field) ? field : null;
};

const mapThreadSandbox = (
  mode: CodexTurnOptionsSchema["sandboxMode"],
): "read-only" | "workspace-write" | "danger-full-access" | undefined => {
  if (mode === "readOnly") return "read-only";
  if (mode === "workspaceWrite") return "workspace-write";
  if (mode === "dangerFullAccess") return "danger-full-access";
  return undefined;
};

const mapTurnSandboxPolicy = (options: CodexTurnOptionsSchema | undefined) => {
  if (options?.sandboxMode === "dangerFullAccess") {
    return {
      type: "dangerFullAccess",
    };
  }

  if (options?.sandboxMode === "readOnly") {
    return {
      type: "readOnly",
    };
  }

  if (options?.sandboxMode === "workspaceWrite") {
    return {
      type: "workspaceWrite",
      writableRoots: options.writableRoots ?? [],
      networkAccess: options.networkAccess ?? false,
      excludeTmpdirEnvVar: false,
      excludeSlashTmp: false,
    };
  }

  return undefined;
};

const buildUserInputs = (input: UserMessageInputSchema) => {
  const items: Array<Record<string, unknown>> = [
    {
      type: "text",
      text: input.text,
    },
  ];

  const images = input.images ?? [];
  for (const image of images) {
    items.push({
      type: "image",
      url: `data:${image.source.media_type};base64,${image.source.data}`,
    });
  }

  return items;
};

const toPublic = (
  process: CodexSessionProcessRecord,
): PublicSessionProcess => ({
  id: process.id,
  projectId: process.projectId,
  sessionId: process.sessionId,
  status: process.status,
});

const hasAssistantOutputAfterLine = (
  parsedLines: readonly ParsedCodexLine[],
  lineCountBaseline: number,
): boolean => {
  const startIndex = Math.max(
    0,
    Math.min(lineCountBaseline, parsedLines.length),
  );
  for (const line of parsedLines.slice(startIndex)) {
    if (line.type === "event_msg" && line.payload.type === "agent_message") {
      return true;
    }

    if (line.type === "response_item") {
      const payloadType = getStringField(line.payload, "type");
      const role = getStringField(line.payload, "role");
      if (payloadType === "message" && role === "assistant") {
        return true;
      }
    }
  }

  return false;
};

const LayerImpl = Effect.gen(function* () {
  const rpc = yield* CodexRpcClientService;
  const eventBus = yield* EventBus;
  const sessionIndexService = yield* SessionIndexService;
  const processesRef = yield* getSharedProcessesRef();

  const emitChanged = (changed: CodexSessionProcessRecord) =>
    Effect.gen(function* () {
      const map = yield* Ref.get(processesRef);
      const processes = Array.from(map.values()).map(toPublic);
      yield* eventBus.emit("sessionProcessChanged", {
        processes,
        changed: toPublic(changed),
      });
    });

  const upsert = (process: CodexSessionProcessRecord) =>
    Effect.gen(function* () {
      yield* Ref.update(processesRef, (map) => {
        const next = new Map(map);
        next.set(process.id, process);
        return next;
      });
      yield* emitChanged(process);
      return process;
    });

  const getSessionProcess = (
    sessionProcessId: string,
  ): Effect.Effect<CodexSessionProcessRecord, SessionProcessNotFoundError> =>
    Effect.gen(function* () {
      const map = yield* Ref.get(processesRef);
      const process = map.get(sessionProcessId);
      if (process === undefined) {
        return yield* Effect.fail(
          new SessionProcessNotFoundError({ sessionProcessId }),
        );
      }
      return process;
    });

  const getSessionProcesses = (): Effect.Effect<PublicSessionProcess[]> =>
    Effect.gen(function* () {
      const map = yield* Ref.get(processesRef);
      return Array.from(map.values()).map(toPublic);
    });

  const findBySessionId = (sessionId: string) =>
    Effect.gen(function* () {
      const map = yield* Ref.get(processesRef);
      const process = Array.from(map.values())
        .filter((item) => item.sessionId === sessionId)
        .toSorted((a, b) => b.updatedAt - a.updatedAt)
        .at(0);
      return process ?? null;
    });

  const updateStatusBySessionId = (
    sessionId: string,
    status: CodexProcessState,
    nextTurnId?: string | null,
  ) =>
    Effect.gen(function* () {
      const process = yield* findBySessionId(sessionId);
      if (process === null) {
        return null;
      }

      const updated: CodexSessionProcessRecord = {
        ...process,
        status,
        lastTurnId: nextTurnId === undefined ? process.lastTurnId : nextTurnId,
        updatedAt: Date.now(),
      };

      yield* upsert(updated);
      return updated;
    });

  const updateStatusById = (
    sessionProcessId: string,
    status: CodexProcessState,
    nextTurnId?: string | null,
  ) =>
    Effect.gen(function* () {
      const process = yield* getSessionProcess(sessionProcessId);
      const updated: CodexSessionProcessRecord = {
        ...process,
        status,
        lastTurnId: nextTurnId === undefined ? process.lastTurnId : nextTurnId,
        updatedAt: Date.now(),
      };
      return yield* upsert(updated);
    });

  const monitorAssistantOutput = (options: {
    sessionProcessId: string;
    threadId: string;
    lineCountBaseline: number;
    attempts: number;
  }): Effect.Effect<void, unknown> =>
    Effect.gen(function* () {
      const process = yield* getSessionProcess(options.sessionProcessId).pipe(
        Effect.catchTag("SessionProcessNotFoundError", () =>
          Effect.succeed(null),
        ),
      );
      if (process === null || process.status !== "running") {
        return;
      }

      const sessionRecord = yield* sessionIndexService
        .getSessionByThreadId(options.threadId)
        .pipe(Effect.catchAll(() => Effect.succeed(null)));

      if (
        sessionRecord !== null &&
        hasAssistantOutputAfterLine(
          sessionRecord.parsedLines,
          options.lineCountBaseline,
        )
      ) {
        yield* updateStatusById(options.sessionProcessId, "paused");
        return;
      }

      if (options.attempts >= 300) {
        return;
      }

      yield* Effect.sleep("1 second");
      yield* monitorAssistantOutput({
        ...options,
        attempts: options.attempts + 1,
      });
    });

  const createThread = (options: {
    cwd: string;
    baseSession:
      | undefined
      | { type: "fork"; sessionId: string }
      | { type: "resume"; sessionId: string };
    turnOptions?: CodexTurnOptionsSchema;
  }) =>
    Effect.gen(function* () {
      const commonParams = {
        cwd: options.cwd,
        ...(options.turnOptions?.model !== undefined
          ? { model: options.turnOptions.model }
          : {}),
        ...(options.turnOptions?.approvalPolicy !== undefined
          ? { approvalPolicy: options.turnOptions.approvalPolicy }
          : {}),
        ...(options.turnOptions?.sandboxMode !== undefined
          ? { sandbox: mapThreadSandbox(options.turnOptions.sandboxMode) }
          : {}),
      };

      const result = yield* options.baseSession === undefined
        ? rpc.sendRequest("thread/start", commonParams)
        : options.baseSession.type === "fork"
          ? rpc.sendRequest("thread/fork", {
              threadId: options.baseSession.sessionId,
              ...commonParams,
            })
          : rpc.sendRequest("thread/resume", {
              threadId: options.baseSession.sessionId,
              ...commonParams,
            });

      const thread = getRecordField(result, "thread");
      const threadId = getStringField(thread, "id");
      if (threadId === null) {
        return yield* Effect.fail(
          new Error("Invalid thread response: missing thread id"),
        );
      }
      return threadId;
    });

  const startTurn = (options: {
    threadId: string;
    input: UserMessageInputSchema;
    cwd: string;
    turnOptions?: CodexTurnOptionsSchema;
  }) =>
    Effect.gen(function* () {
      const result = yield* rpc.sendRequest("turn/start", {
        threadId: options.threadId,
        input: buildUserInputs(options.input),
        cwd: options.cwd,
        effort: "high",
        ...(options.turnOptions?.model !== undefined
          ? { model: options.turnOptions.model }
          : {}),
        ...(options.turnOptions?.approvalPolicy !== undefined
          ? { approvalPolicy: options.turnOptions.approvalPolicy }
          : {}),
        ...(mapTurnSandboxPolicy(options.turnOptions) !== undefined
          ? { sandboxPolicy: mapTurnSandboxPolicy(options.turnOptions) }
          : {}),
      });

      const turn = getRecordField(result, "turn");
      const turnId = getStringField(turn, "id");
      return turnId;
    });

  const startSessionProcess = (options: {
    projectId: string;
    cwd: string;
    input: UserMessageInputSchema;
    baseSession:
      | undefined
      | { type: "fork"; sessionId: string }
      | { type: "resume"; sessionId: string };
    turnOptions?: CodexTurnOptionsSchema;
  }): Effect.Effect<{ sessionProcess: PublicSessionProcess }, unknown> =>
    Effect.gen(function* () {
      yield* rpc.ensureInitialized();

      const threadId = yield* createThread({
        cwd: options.cwd,
        baseSession: options.baseSession,
        turnOptions: options.turnOptions,
      });

      const baselineRecord = yield* sessionIndexService
        .getSessionByThreadId(threadId)
        .pipe(Effect.catchAll(() => Effect.succeed(null)));
      const lineCountBaseline = baselineRecord?.lineCount ?? 0;

      const process: CodexSessionProcessRecord = {
        id: ulid(),
        projectId: options.projectId,
        sessionId: threadId,
        cwd: options.cwd,
        status: "running",
        lastTurnId: null,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      yield* upsert(process);

      const turnId = yield* startTurn({
        threadId,
        input: options.input,
        cwd: options.cwd,
        turnOptions: options.turnOptions,
      });

      const withTurnId = yield* updateStatusById(process.id, "running", turnId);

      Effect.runFork(
        monitorAssistantOutput({
          sessionProcessId: process.id,
          threadId,
          lineCountBaseline,
          attempts: 0,
        }),
      );

      return {
        sessionProcess: toPublic(withTurnId),
      };
    });

  const continueSessionProcess = (options: {
    sessionProcessId: string;
    baseSessionId: string;
    input: UserMessageInputSchema;
    turnOptions?: CodexTurnOptionsSchema;
  }): Effect.Effect<{ sessionProcess: PublicSessionProcess }, unknown> =>
    Effect.gen(function* () {
      const existing = yield* getSessionProcess(options.sessionProcessId);
      const baselineRecord = yield* sessionIndexService
        .getSessionByThreadId(options.baseSessionId)
        .pipe(Effect.catchAll(() => Effect.succeed(null)));
      const lineCountBaseline = baselineRecord?.lineCount ?? 0;

      const turnId = yield* startTurn({
        threadId: options.baseSessionId,
        input: options.input,
        cwd: existing.cwd,
        turnOptions: options.turnOptions,
      });

      const updated = yield* updateStatusById(
        options.sessionProcessId,
        "running",
        turnId,
      );

      Effect.runFork(
        monitorAssistantOutput({
          sessionProcessId: options.sessionProcessId,
          threadId: options.baseSessionId,
          lineCountBaseline,
          attempts: 0,
        }),
      );

      return {
        sessionProcess: toPublic(updated),
      };
    });

  const abortSessionProcess = (
    sessionProcessId: string,
  ): Effect.Effect<void, unknown> =>
    Effect.gen(function* () {
      const process = yield* getSessionProcess(sessionProcessId);
      yield* rpc
        .sendRequest("turn/interrupt", {
          threadId: process.sessionId,
        })
        .pipe(Effect.catchAll(() => Effect.void));
      yield* updateStatusById(sessionProcessId, "completed");
    });

  const handleRpcNotification = (notification: {
    method: string;
    params?: unknown;
  }): Effect.Effect<void, unknown> =>
    Effect.gen(function* () {
      if (notification.method === "turn/started") {
        const threadId = getStringField(notification.params, "threadId");
        const turn = getRecordField(notification.params, "turn");
        const turnId = getStringField(turn, "id");
        if (threadId !== null) {
          yield* updateStatusBySessionId(
            threadId,
            "running",
            turnId ?? undefined,
          );
        }
        return;
      }

      if (notification.method === "turn/completed") {
        const threadId = getStringField(notification.params, "threadId");
        const turn = getRecordField(notification.params, "turn");
        const turnStatus = getStringField(turn, "status");
        const turnId = getStringField(turn, "id");
        if (threadId === null) {
          return;
        }

        const status: CodexProcessState =
          turnStatus === "interrupted" ? "completed" : "paused";
        yield* updateStatusBySessionId(threadId, status, turnId ?? undefined);
        return;
      }

      if (
        notification.method === "item/completed" ||
        notification.method === "rawResponseItem/completed"
      ) {
        const threadId =
          getStringField(notification.params, "threadId") ??
          getStringField(notification.params, "thread_id");
        if (threadId === null) {
          return;
        }

        const item = getRecordField(notification.params, "item");
        const itemType = getStringField(item, "type");
        const role = getStringField(item, "role");
        const normalizedItemType = itemType?.toLowerCase() ?? null;

        if (
          (normalizedItemType === "message" && role === "assistant") ||
          normalizedItemType === "agentmessage"
        ) {
          yield* updateStatusBySessionId(threadId, "paused");
        }
        return;
      }

      if (notification.method === "turn/interrupt") {
        const threadId = getStringField(notification.params, "threadId");
        const turn = getRecordField(notification.params, "turn");
        const turnStatusFromTurn = getStringField(turn, "status");
        const turnStatusFromParams = getStringField(
          notification.params,
          "status",
        );
        const turnStatus = turnStatusFromTurn ?? turnStatusFromParams;
        const turnId =
          getStringField(turn, "id") ??
          getStringField(notification.params, "turnId");

        if (threadId === null) {
          return;
        }

        const status: CodexProcessState =
          turnStatus === "interrupted" ||
          turnStatus === "completed" ||
          turnStatus === "aborted"
            ? "completed"
            : "paused";

        yield* updateStatusBySessionId(threadId, status, turnId ?? undefined);
      }
    });

  const setAwaitingApproval = (
    sessionId: string,
  ): Effect.Effect<CodexSessionProcessRecord | null, unknown> =>
    updateStatusBySessionId(sessionId, "awaiting_approval");

  const resumeAfterApproval = (
    sessionId: string,
  ): Effect.Effect<CodexSessionProcessRecord | null, unknown> =>
    updateStatusBySessionId(sessionId, "running");

  return {
    startSessionProcess,
    continueSessionProcess,
    abortSessionProcess,
    getSessionProcesses,
    getSessionProcess,
    handleRpcNotification,
    setAwaitingApproval,
    resumeAfterApproval,
  } satisfies CodexSessionProcessServiceInterface;
});

export type ICodexSessionProcessService = CodexSessionProcessServiceInterface;
export class CodexSessionProcessService extends Context.Tag(
  "CodexSessionProcessService",
)<CodexSessionProcessService, ICodexSessionProcessService>() {
  static Live = Layer.effect(this, LayerImpl);
}
