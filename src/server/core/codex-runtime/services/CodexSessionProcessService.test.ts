import { Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";
import { EventBus } from "../../events/services/EventBus";
import { SessionIndexService } from "../../session/infrastructure/SessionIndexService";
import {
  CodexRpcClientService,
  type ICodexRpcClientService,
} from "./CodexRpcClientService";
import { CodexSessionProcessService } from "./CodexSessionProcessService";

type RpcCall = {
  method: string;
  params?: unknown;
};

const createRpcLayer = (calls: RpcCall[]) => {
  const rpc: ICodexRpcClientService = {
    ensureInitialized: () => Effect.void,
    sendRequest: (method, params) => {
      calls.push({ method, params });

      if (method === "thread/start") {
        return Effect.succeed({
          thread: {
            id: "thread-started",
          },
        });
      }

      if (method === "thread/fork") {
        return Effect.succeed({
          thread: {
            id: "thread-forked",
          },
        });
      }

      if (method === "thread/resume") {
        return Effect.succeed({
          thread: {
            id: "thread-resumed",
          },
        });
      }

      if (method === "turn/start") {
        return Effect.succeed({
          turn: {
            id: "turn-started",
          },
        });
      }

      if (method === "turn/interrupt") {
        return Effect.succeed({});
      }

      return Effect.fail(new Error(`Unexpected RPC method: ${method}`));
    },
    sendNotification: () => Effect.void,
    respond: () => Effect.void,
    onNotification: () => Effect.succeed(() => undefined),
    onServerRequest: () => Effect.succeed(() => undefined),
  };

  return Layer.succeed(CodexRpcClientService, rpc);
};

const runWithService = <A, E>(
  program: Effect.Effect<A, E, CodexSessionProcessService>,
  rpcLayer: Layer.Layer<CodexRpcClientService>,
) =>
  Effect.runPromise(
    program.pipe(
      Effect.provide(CodexSessionProcessService.Live),
      Effect.provide(EventBus.Live),
      Effect.provide(
        Layer.succeed(SessionIndexService, {
          getSessionIndices: () => Effect.succeed([]),
          getSessionByThreadId: () => Effect.succeed(null),
        }),
      ),
      Effect.provide(rpcLayer),
    ),
  );

describe("CodexSessionProcessService", () => {
  it("starts a session process with Codex turn options", async () => {
    const calls: RpcCall[] = [];
    const rpcLayer = createRpcLayer(calls);

    const result = await runWithService(
      Effect.gen(function* () {
        const service = yield* CodexSessionProcessService;
        return yield* service.startSessionProcess({
          projectId: "project-1",
          cwd: "/tmp/project-1",
          input: {
            text: "hello from codex",
            images: [
              {
                type: "image",
                source: {
                  type: "base64",
                  media_type: "image/png",
                  data: "ZmFrZS1pbWFnZS1kYXRh",
                },
              },
            ],
          },
          baseSession: undefined,
          turnOptions: {
            model: "gpt-5",
            approvalPolicy: "on-request",
            sandboxMode: "workspaceWrite",
            writableRoots: ["/tmp/project-1"],
            networkAccess: true,
          },
        });
      }),
      rpcLayer,
    );

    expect(result.sessionProcess.projectId).toBe("project-1");
    expect(result.sessionProcess.sessionId).toBe("thread-started");
    expect(result.sessionProcess.status).toBe("running");

    expect(calls[0]?.method).toBe("thread/start");
    expect(calls[0]?.params).toEqual({
      cwd: "/tmp/project-1",
      model: "gpt-5",
      approvalPolicy: "on-request",
      sandbox: "workspace-write",
    });

    expect(calls[1]?.method).toBe("turn/start");
    expect(calls[1]?.params).toMatchObject({
      threadId: "thread-started",
      cwd: "/tmp/project-1",
      effort: "high",
      model: "gpt-5",
      approvalPolicy: "on-request",
      sandboxPolicy: {
        type: "workspaceWrite",
        writableRoots: ["/tmp/project-1"],
        networkAccess: true,
      },
      input: [
        {
          type: "text",
          text: "hello from codex",
        },
        {
          type: "image",
          url: "data:image/png;base64,ZmFrZS1pbWFnZS1kYXRh",
        },
      ],
    });
  });

  it("uses thread/fork and thread/resume for base sessions", async () => {
    const calls: RpcCall[] = [];
    const rpcLayer = createRpcLayer(calls);

    const result = await runWithService(
      Effect.gen(function* () {
        const service = yield* CodexSessionProcessService;
        const forked = yield* service.startSessionProcess({
          projectId: "project-1",
          cwd: "/tmp/project-1",
          input: {
            text: "fork",
          },
          baseSession: {
            type: "fork",
            sessionId: "base-thread-fork",
          },
        });

        const resumed = yield* service.startSessionProcess({
          projectId: "project-1",
          cwd: "/tmp/project-1",
          input: {
            text: "resume",
          },
          baseSession: {
            type: "resume",
            sessionId: "base-thread-resume",
          },
        });

        return { forked, resumed };
      }),
      rpcLayer,
    );

    expect(result.forked.sessionProcess.sessionId).toBe("thread-forked");
    expect(result.resumed.sessionProcess.sessionId).toBe("thread-resumed");

    expect(calls[0]?.method).toBe("thread/fork");
    expect(calls[0]?.params).toEqual({
      threadId: "base-thread-fork",
      cwd: "/tmp/project-1",
    });

    expect(calls[2]?.method).toBe("thread/resume");
    expect(calls[2]?.params).toEqual({
      threadId: "base-thread-resume",
      cwd: "/tmp/project-1",
    });
  });

  it("maps runtime notifications into process state transitions", async () => {
    const calls: RpcCall[] = [];
    const rpcLayer = createRpcLayer(calls);

    const result = await runWithService(
      Effect.gen(function* () {
        const service = yield* CodexSessionProcessService;
        const started = yield* service.startSessionProcess({
          projectId: "project-1",
          cwd: "/tmp/project-1",
          input: {
            text: "start",
          },
          baseSession: undefined,
        });

        yield* service.handleRpcNotification({
          method: "turn/completed",
          params: {
            threadId: started.sessionProcess.sessionId,
            turn: {
              id: "turn-completed",
              status: "completed",
            },
          },
        });

        const paused = yield* service.getSessionProcess(
          started.sessionProcess.id,
        );

        yield* service.handleRpcNotification({
          method: "item/completed",
          params: {
            threadId: started.sessionProcess.sessionId,
            item: {
              type: "message",
              role: "assistant",
            },
          },
        });

        const pausedFromItem = yield* service.getSessionProcess(
          started.sessionProcess.id,
        );

        yield* service.handleRpcNotification({
          method: "turn/interrupt",
          params: {
            threadId: started.sessionProcess.sessionId,
          },
        });

        const interrupted = yield* service.getSessionProcess(
          started.sessionProcess.id,
        );

        yield* service.handleRpcNotification({
          method: "turn/interrupt",
          params: {
            threadId: started.sessionProcess.sessionId,
            turn: {
              status: "interrupted",
            },
          },
        });

        const completed = yield* service.getSessionProcess(
          started.sessionProcess.id,
        );

        return { paused, pausedFromItem, interrupted, completed };
      }),
      rpcLayer,
    );

    expect(result.paused.status).toBe("paused");
    expect(result.pausedFromItem.status).toBe("paused");
    expect(result.interrupted.status).toBe("paused");
    expect(result.completed.status).toBe("completed");
  });

  it("aborts a process and marks it completed", async () => {
    const calls: RpcCall[] = [];
    const rpcLayer = createRpcLayer(calls);

    const result = await runWithService(
      Effect.gen(function* () {
        const service = yield* CodexSessionProcessService;
        const started = yield* service.startSessionProcess({
          projectId: "project-1",
          cwd: "/tmp/project-1",
          input: {
            text: "abort",
          },
          baseSession: undefined,
        });

        yield* service.abortSessionProcess(started.sessionProcess.id);
        return yield* service.getSessionProcess(started.sessionProcess.id);
      }),
      rpcLayer,
    );

    const interruptCall = calls.find(
      (call) => call.method === "turn/interrupt",
    );

    expect(interruptCall).toBeDefined();
    expect(result.status).toBe("completed");
  });
});
