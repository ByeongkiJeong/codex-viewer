import { zValidator } from "@hono/zod-validator";
import { Effect } from "effect";
import { Hono } from "hono";
import { z } from "zod";
import { CodexController } from "../../core/codex-runtime/presentation/CodexController";
import { CodexPermissionController } from "../../core/codex-runtime/presentation/CodexPermissionController";
import { CodexSessionProcessController } from "../../core/codex-runtime/presentation/CodexSessionProcessController";
import {
  codexTurnOptionsSchema,
  userMessageInputSchema,
} from "../../core/codex-runtime/schema";
import { AppServerUnavailableError } from "../../core/codex-runtime/services/CodexAppServerService";
import { CodexLifeCycleService } from "../../core/codex-runtime/services/CodexLifeCycleService";
import type { HonoContext } from "../app";
import { getHonoRuntime } from "../runtime";

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

const codexRoutes = Effect.gen(function* () {
  const codexController = yield* CodexController;
  const sessionProcessController = yield* CodexSessionProcessController;
  const permissionController = yield* CodexPermissionController;
  const lifeCycleService = yield* CodexLifeCycleService;
  const runtime = yield* getHonoRuntime;

  return new Hono<HonoContext>()
    .get("/meta", async (c) => {
      const result = await Effect.runPromise(
        codexController.getCodexMeta().pipe(Effect.provide(runtime)),
      );
      return c.json(result.response, result.status);
    })
    .get("/features", async (c) => {
      const result = await Effect.runPromise(
        codexController.getAvailableFeatures().pipe(Effect.provide(runtime)),
      );
      return c.json(result.response, result.status);
    })
    .get("/session-processes", async (c) => {
      const result = await Effect.runPromise(
        sessionProcessController
          .getSessionProcesses()
          .pipe(Effect.provide(runtime)),
      );
      return c.json(result.response, result.status);
    })
    .post(
      "/session-processes",
      zValidator(
        "json",
        z.object({
          projectId: z.string(),
          input: userMessageInputSchema,
          baseSession: z
            .union([
              z.object({
                type: z.literal("fork"),
                sessionId: z.string(),
              }),
              z.object({
                type: z.literal("resume"),
                sessionId: z.string(),
              }),
            ])
            .optional(),
          codexTurnOptions: codexTurnOptionsSchema.optional(),
        }),
      ),
      async (c) => {
        const body = c.req.valid("json");
        const result = await Effect.runPromise(
          sessionProcessController
            .createSessionProcess({
              projectId: body.projectId,
              input: body.input,
              baseSession: body.baseSession,
              codexTurnOptions: body.codexTurnOptions,
            })
            .pipe(Effect.provide(runtime)),
        );
        return c.json(result.response, result.status);
      },
    )
    .post(
      "/session-processes/:sessionProcessId/continue",
      zValidator(
        "json",
        z.object({
          projectId: z.string(),
          input: userMessageInputSchema,
          baseSessionId: z.string(),
          codexTurnOptions: codexTurnOptionsSchema.optional(),
        }),
      ),
      async (c) => {
        const body = c.req.valid("json");
        const { sessionProcessId } = c.req.param();
        const result = await Effect.runPromise(
          sessionProcessController
            .continueSessionProcess({
              sessionProcessId,
              baseSessionId: body.baseSessionId,
              input: body.input,
              codexTurnOptions: body.codexTurnOptions,
            })
            .pipe(Effect.provide(runtime)),
        );
        return c.json(result.response, result.status);
      },
    )
    .post(
      "/session-processes/:sessionProcessId/abort",
      zValidator("json", z.object({ projectId: z.string() })),
      async (c) => {
        const { sessionProcessId } = c.req.param();
        const outcome = await Effect.runPromise(
          lifeCycleService.abortTask(sessionProcessId).pipe(
            Effect.provide(runtime),
            Effect.map(() => ({ ok: true as const })),
            Effect.catchIf(isAppServerUnavailableError, (error) =>
              Effect.succeed({
                ok: false as const,
                error,
              }),
            ),
          ),
        );

        if (outcome.ok === false) {
          return c.json(
            {
              error: "Codex app-server unavailable",
              reason: outcome.error.message,
            },
            503,
          );
        }

        return c.json({ message: "Task aborted" });
      },
    )
    .post(
      "/permission-response",
      zValidator(
        "json",
        z.object({
          permissionRequestId: z.string(),
          decision: z.enum(["allow", "deny"]),
        }),
      ),
      async (c) => {
        const result = await Effect.runPromise(
          permissionController
            .permissionResponse({
              permissionResponse: c.req.valid("json"),
            })
            .pipe(Effect.provide(runtime)),
        );
        return c.json(result.response, result.status);
      },
    );
});

export { codexRoutes };
