import { Context, Effect, Layer } from "effect";
import type { ControllerResponse } from "../../../lib/effect/toEffectResponse";
import type { InferEffect } from "../../../lib/effect/types";
import { decodeProjectId } from "../../project/functions/id";
import type { CodexTurnOptionsSchema, UserMessageInputSchema } from "../schema";
import { AppServerUnavailableError } from "../services/CodexAppServerService";
import { CodexLifeCycleService } from "../services/CodexLifeCycleService";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isAppServerUnavailableError = (
  error: unknown,
): error is AppServerUnavailableError => {
  if (error instanceof AppServerUnavailableError) {
    return true;
  }

  if (!isRecord(error)) {
    return false;
  }

  return (
    error._tag === "AppServerUnavailableError" &&
    typeof error.message === "string"
  );
};

const LayerImpl = Effect.gen(function* () {
  const lifeCycleService = yield* CodexLifeCycleService;

  const appServerUnavailableResponse = (error: AppServerUnavailableError) =>
    ({
      status: 503,
      response: {
        error: "Codex app-server unavailable",
        reason: error.message,
      },
    }) as const satisfies ControllerResponse;

  const withAppServerGuard = <T extends ControllerResponse>(
    effect: Effect.Effect<T, unknown, never>,
  ): Effect.Effect<T | ControllerResponse, unknown, never> =>
    effect.pipe(
      Effect.catchIf(isAppServerUnavailableError, (error) =>
        Effect.succeed(appServerUnavailableResponse(error)),
      ),
    );

  const getSessionProcesses = () =>
    withAppServerGuard(
      Effect.gen(function* () {
        const processes = yield* lifeCycleService.getSessionProcesses();
        return {
          status: 200,
          response: {
            processes,
          },
        } as const satisfies ControllerResponse;
      }),
    );

  const createSessionProcess = (options: {
    projectId: string;
    input: UserMessageInputSchema;
    baseSession:
      | undefined
      | { type: "fork"; sessionId: string }
      | { type: "resume"; sessionId: string };
    codexTurnOptions?: CodexTurnOptionsSchema;
  }) =>
    withAppServerGuard(
      Effect.gen(function* () {
        const cwd = decodeProjectId(options.projectId);
        const created = yield* lifeCycleService.startSessionProcess({
          projectId: options.projectId,
          cwd,
          input: options.input,
          baseSession: options.baseSession,
          turnOptions: options.codexTurnOptions,
        });

        return {
          status: 201,
          response: created,
        } as const satisfies ControllerResponse;
      }),
    );

  const continueSessionProcess = (options: {
    sessionProcessId: string;
    baseSessionId: string;
    input: UserMessageInputSchema;
    codexTurnOptions?: CodexTurnOptionsSchema;
  }) =>
    withAppServerGuard(
      Effect.gen(function* () {
        const continued = yield* lifeCycleService.continueSessionProcess({
          sessionProcessId: options.sessionProcessId,
          baseSessionId: options.baseSessionId,
          input: options.input,
          turnOptions: options.codexTurnOptions,
        });
        return {
          status: 200,
          response: continued,
        } as const satisfies ControllerResponse;
      }),
    );

  return {
    getSessionProcesses,
    createSessionProcess,
    continueSessionProcess,
  };
});

export type ICodexSessionProcessController = InferEffect<typeof LayerImpl>;
export class CodexSessionProcessController extends Context.Tag(
  "CodexSessionProcessController",
)<CodexSessionProcessController, ICodexSessionProcessController>() {
  static Live = Layer.effect(this, LayerImpl);
}
