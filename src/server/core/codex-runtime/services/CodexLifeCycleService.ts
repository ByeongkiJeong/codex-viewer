import { Context, Effect, Layer, Ref } from "effect";
import type { PublicSessionProcess } from "../../../../types/session-process";
import type { CodexTurnOptionsSchema, UserMessageInputSchema } from "../schema";
import { CodexApprovalService } from "./CodexApprovalService";
import { CodexRpcClientService } from "./CodexRpcClientService";
import { CodexSessionProcessService } from "./CodexSessionProcessService";

interface CodexLifeCycleServiceInterface {
  readonly ensureStarted: () => Effect.Effect<void, unknown>;
  readonly getSessionProcesses: () => Effect.Effect<
    PublicSessionProcess[],
    unknown
  >;
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
  readonly abortTask: (
    sessionProcessId: string,
  ) => Effect.Effect<void, unknown>;
  readonly abortAllTasks: () => Effect.Effect<void, unknown>;
}

const LayerImpl = Effect.gen(function* () {
  const rpc = yield* CodexRpcClientService;
  const approvalService = yield* CodexApprovalService;
  const processService = yield* CodexSessionProcessService;
  const startedRef = yield* Ref.make(false);

  const ensureStarted = (): Effect.Effect<void, unknown> =>
    Effect.gen(function* () {
      const started = yield* Ref.get(startedRef);
      if (started) {
        return;
      }

      yield* rpc.ensureInitialized();

      yield* rpc.onNotification((notification) => {
        Effect.runFork(processService.handleRpcNotification(notification));
      });

      yield* rpc.onServerRequest((request) => {
        Effect.runFork(approvalService.handleRpcRequest(request));
      });

      yield* Ref.set(startedRef, true);
    });

  const getSessionProcesses = (): Effect.Effect<
    PublicSessionProcess[],
    unknown
  > =>
    Effect.gen(function* () {
      yield* ensureStarted();
      return yield* processService.getSessionProcesses();
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
      yield* ensureStarted();
      return yield* processService.startSessionProcess(options);
    });

  const continueSessionProcess = (options: {
    sessionProcessId: string;
    baseSessionId: string;
    input: UserMessageInputSchema;
    turnOptions?: CodexTurnOptionsSchema;
  }): Effect.Effect<{ sessionProcess: PublicSessionProcess }, unknown> =>
    Effect.gen(function* () {
      yield* ensureStarted();
      return yield* processService.continueSessionProcess(options);
    });

  const abortTask = (sessionProcessId: string): Effect.Effect<void, unknown> =>
    Effect.gen(function* () {
      yield* ensureStarted();
      yield* processService.abortSessionProcess(sessionProcessId);
    });

  const abortAllTasks = (): Effect.Effect<void, unknown> =>
    Effect.gen(function* () {
      yield* ensureStarted();
      const processes = yield* processService.getSessionProcesses();
      for (const process of processes) {
        if (process.status === "completed") {
          continue;
        }
        yield* processService.abortSessionProcess(process.id);
      }
    });

  return {
    ensureStarted,
    getSessionProcesses,
    startSessionProcess,
    continueSessionProcess,
    abortTask,
    abortAllTasks,
  } satisfies CodexLifeCycleServiceInterface;
});

export type ICodexLifeCycleService = CodexLifeCycleServiceInterface;
export class CodexLifeCycleService extends Context.Tag("CodexLifeCycleService")<
  CodexLifeCycleService,
  ICodexLifeCycleService
>() {
  static Live = Layer.effect(this, LayerImpl);
}
