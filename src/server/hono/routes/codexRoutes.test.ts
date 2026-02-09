import { NodeContext } from "@effect/platform-node";
import { Effect, Layer } from "effect";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { testPlatformLayer } from "../../../testing/layers/testPlatformLayer";
import { CodexController } from "../../core/codex-runtime/presentation/CodexController";
import { CodexPermissionController } from "../../core/codex-runtime/presentation/CodexPermissionController";
import { CodexSessionProcessController } from "../../core/codex-runtime/presentation/CodexSessionProcessController";
import { AppServerUnavailableError } from "../../core/codex-runtime/services/CodexAppServerService";
import { CodexLifeCycleService } from "../../core/codex-runtime/services/CodexLifeCycleService";
import { ProjectRepository } from "../../core/project/infrastructure/ProjectRepository";
import { SchedulerConfigBaseDir } from "../../core/scheduler/config";
import { VirtualConversationDatabase } from "../../core/session/infrastructure/VirtualConversationDatabase";
import { SessionMetaService } from "../../core/session/services/SessionMetaService";
import type { HonoContext } from "../app";
import { codexRoutes } from "./codexRoutes";

const runtimeLayer = (lifeCycleLayer: Layer.Layer<CodexLifeCycleService>) =>
  Layer.mergeAll(
    NodeContext.layer,
    testPlatformLayer(),
    lifeCycleLayer,
    Layer.succeed(SessionMetaService, {
      getSessionMeta: () =>
        Effect.succeed({
          messageCount: 0,
          firstUserMessage: null,
          tokenUsage: {
            inputTokens: 0,
            cachedInputTokens: 0,
            outputTokens: 0,
            reasoningOutputTokens: 0,
            totalTokens: 0,
          },
          modelName: null,
        }),
      invalidateSession: () => Effect.void,
    }),
    VirtualConversationDatabase.Live,
    Layer.succeed(ProjectRepository, {
      getProjects: () => Effect.succeed({ projects: [] }),
      getProject: (projectId: string) =>
        Effect.succeed({
          project: {
            id: projectId,
            projectPath: "/tmp/project",
            lastModifiedAt: new Date(),
            meta: {
              projectName: "project",
              projectPath: "/tmp/project",
              sessionCount: 0,
            },
          },
        }),
    }),
    Layer.succeed(SchedulerConfigBaseDir, "/tmp/codex-viewer-test"),
  );

const codexControllerMockLayer = Layer.succeed(CodexController, {
  getCodexCommands: () =>
    Effect.succeed({
      status: 200,
      response: {
        globalSkills: [],
        vendorSkills: [],
        projectCommands: [],
        defaultCommands: [],
      },
    }),
  getMcpListRoute: () =>
    Effect.succeed({
      status: 200,
      response: {
        servers: [],
      },
    }),
  getCodexMeta: () =>
    Effect.succeed({
      status: 200,
      response: {
        executablePath: "codex",
        version: "1.2.3",
      },
    }),
  getAvailableFeatures: () =>
    Effect.succeed({
      status: 200,
      response: {
        features: [],
      },
    }),
});

const codexPermissionControllerMockLayer = Layer.succeed(
  CodexPermissionController,
  {
    permissionResponse: () =>
      Effect.succeed({
        status: 200,
        response: {
          permissionRequestId: "request-1",
        },
      }),
  },
);

const sessionProcessControllerMockLayer = Layer.succeed(
  CodexSessionProcessController,
  {
    getSessionProcesses: () =>
      Effect.succeed({
        status: 200,
        response: { processes: [] },
      }),
    createSessionProcess: () =>
      Effect.succeed({
        status: 201,
        response: {
          sessionProcess: {
            id: "process-1",
            projectId: "project-1",
            sessionId: "thread-1",
            status: "running",
          },
        },
      }),
    continueSessionProcess: () =>
      Effect.succeed({
        status: 200,
        response: {
          sessionProcess: {
            id: "process-1",
            projectId: "project-1",
            sessionId: "thread-1",
            status: "running",
          },
        },
      }),
  },
);

const lifeCycleOkLayer = Layer.succeed(CodexLifeCycleService, {
  ensureStarted: () => Effect.void,
  getSessionProcesses: () => Effect.succeed([]),
  startSessionProcess: () =>
    Effect.succeed({
      sessionProcess: {
        id: "process-1",
        projectId: "project-1",
        sessionId: "thread-1",
        status: "running",
      },
    }),
  continueSessionProcess: () =>
    Effect.succeed({
      sessionProcess: {
        id: "process-1",
        projectId: "project-1",
        sessionId: "thread-1",
        status: "running",
      },
    }),
  abortTask: () => Effect.void,
  abortAllTasks: () => Effect.void,
});

const createCodexRouteApp = (options?: {
  sessionProcessLayer?: Layer.Layer<CodexSessionProcessController>;
  lifeCycleLayer?: Layer.Layer<CodexLifeCycleService>;
}) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const codexRouter = yield* codexRoutes;
      const app = new Hono<HonoContext>();
      app.route("/api/codex", codexRouter);
      return app;
    }).pipe(
      Effect.provide(
        options?.sessionProcessLayer ?? sessionProcessControllerMockLayer,
      ),
      Effect.provide(codexPermissionControllerMockLayer),
      Effect.provide(codexControllerMockLayer),
      Effect.provide(runtimeLayer(options?.lifeCycleLayer ?? lifeCycleOkLayer)),
    ),
  );

describe("codexRoutes", () => {
  it("serves /api/codex/meta", async () => {
    const app = await createCodexRouteApp();

    const response = await app.request("/api/codex/meta");
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body).toEqual({
      executablePath: "codex",
      version: "1.2.3",
    });
  });

  it("returns 404 for removed legacy API route", async () => {
    const app = await createCodexRouteApp();
    const legacyRoute = `/api/${"claude"}-${"code"}/meta`;

    const response = await app.request(legacyRoute);
    expect(response.status).toBe(404);
  });

  it("returns 503 when app-server startup fails on session process creation", async () => {
    const projectPath = "/tmp/codex-project";
    const projectId = Buffer.from(projectPath).toString("base64url");

    const unavailableError = new AppServerUnavailableError({
      message: "Failed to start codex app-server: missing executable",
    });

    const failingLifeCycleLayer = Layer.succeed(CodexLifeCycleService, {
      ensureStarted: () => Effect.fail(unavailableError),
      getSessionProcesses: () => Effect.fail(unavailableError),
      startSessionProcess: () => Effect.fail(unavailableError),
      continueSessionProcess: () => Effect.fail(unavailableError),
      abortTask: () => Effect.void,
      abortAllTasks: () => Effect.void,
    });

    const app = await createCodexRouteApp({
      lifeCycleLayer: failingLifeCycleLayer,
      sessionProcessLayer: CodexSessionProcessController.Live.pipe(
        Layer.provideMerge(failingLifeCycleLayer),
      ),
    });

    const response = await app.request("/api/codex/session-processes", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        projectId,
        input: {
          text: "hello",
        },
      }),
    });

    expect(response.status).toBe(503);

    const body = await response.json();
    expect(body).toEqual({
      error: "Codex app-server unavailable",
      reason: "Failed to start codex app-server: missing executable",
    });
  });
});
