import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { NodeContext } from "@effect/platform-node";
import { createAdaptorServer } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Effect, Layer } from "effect";
import { CodexController } from "./core/codex-runtime/presentation/CodexController";
import { CodexPermissionController } from "./core/codex-runtime/presentation/CodexPermissionController";
import { CodexSessionProcessController } from "./core/codex-runtime/presentation/CodexSessionProcessController";
import { CodexApprovalService } from "./core/codex-runtime/services/CodexApprovalService";
import { CodexAppServerService } from "./core/codex-runtime/services/CodexAppServerService";
import { CodexLifeCycleService } from "./core/codex-runtime/services/CodexLifeCycleService";
import { CodexRpcClientService } from "./core/codex-runtime/services/CodexRpcClientService";
import { CodexService } from "./core/codex-runtime/services/CodexService";
import { CodexSessionProcessService } from "./core/codex-runtime/services/CodexSessionProcessService";
import { SSEController } from "./core/events/presentation/SSEController";
import { FileWatcherService } from "./core/events/services/fileWatcher";
import { FeatureFlagController } from "./core/feature-flag/presentation/FeatureFlagController";
import { FileSystemController } from "./core/file-system/presentation/FileSystemController";
import { GitController } from "./core/git/presentation/GitController";
import { GitService } from "./core/git/services/GitService";
import { isDevelopmentEnv } from "./core/platform/ccvEnv";
import type { CliOptions } from "./core/platform/services/CcvOptionsService";
import { ProjectRepository } from "./core/project/infrastructure/ProjectRepository";
import { ProjectController } from "./core/project/presentation/ProjectController";
import { ProjectMetaService } from "./core/project/services/ProjectMetaService";
import { SchedulerConfigBaseDir } from "./core/scheduler/config";
import { SchedulerService } from "./core/scheduler/domain/Scheduler";
import { SchedulerController } from "./core/scheduler/presentation/SchedulerController";
import { SearchController } from "./core/search/presentation/SearchController";
import { SearchService } from "./core/search/services/SearchService";
import { SessionIndexService } from "./core/session/infrastructure/SessionIndexService";
import { SessionRepository } from "./core/session/infrastructure/SessionRepository";
import { VirtualConversationDatabase } from "./core/session/infrastructure/VirtualConversationDatabase";
import { SessionController } from "./core/session/presentation/SessionController";
import { SessionMetaService } from "./core/session/services/SessionMetaService";
import { TasksController } from "./core/tasks/presentation/TasksController";
import { TasksService } from "./core/tasks/services/TasksService";
import { TerminalService } from "./core/terminal/TerminalService";
import { honoApp } from "./hono/app";
import { InitializeService } from "./hono/initialize";
import { AuthMiddleware } from "./hono/middleware/auth.middleware";
import { routes } from "./hono/routes";
import { platformLayer } from "./lib/effect/layers";
import { setupTerminalWebSocket } from "./terminal/terminalWebSocket";

export const startServer = async (options: CliOptions) => {
  // biome-ignore lint/style/noProcessEnv: allow only here
  const isDevelopment = isDevelopmentEnv(process.env.CCV_ENV);

  if (!isDevelopment) {
    const staticPath = resolve(import.meta.dirname, "static");
    console.log("Serving static files from ", staticPath);

    honoApp.use(
      "/assets/*",
      serveStatic({
        root: staticPath,
      }),
    );

    honoApp.use("*", async (c, next) => {
      if (c.req.path.startsWith("/api")) {
        return next();
      }

      const html = await readFile(resolve(staticPath, "index.html"), "utf-8");
      return c.html(html);
    });
  }

  const server = createAdaptorServer({
    fetch: honoApp.fetch,
  });

  const program = Effect.gen(function* () {
    yield* routes(honoApp, options);
    yield* setupTerminalWebSocket(server);
  }).pipe(
    Effect.provide(MainLayer),
    Effect.provide(DomainLayer),
    Effect.provide(DomainBase),
    Effect.provide(InfraBasics),
    Effect.provide(InfraLayer),
    Effect.provide(CodexLifeCycleService.Live),
    Effect.provide(CodexApprovalService.Live),
    Effect.provide(CodexSessionProcessService.Live),
    Effect.provide(CodexRpcClientService.Live),
    Effect.provide(CodexAppServerService.Live),
    Effect.provide(SessionIndexService.Live),
    Effect.provide(PlatformLayer),
    Effect.scoped,
  );

  await Effect.runPromise(program);

  const port = isDevelopment
    ? // biome-ignore lint/style/noProcessEnv: allow only here
      (process.env.DEV_BE_PORT ?? "3401")
    : // biome-ignore lint/style/noProcessEnv: allow only here
      (options.port ?? process.env.PORT ?? "3000");

  // biome-ignore lint/style/noProcessEnv: allow only here
  const hostname = options.hostname ?? process.env.HOSTNAME ?? "localhost";

  server.listen(parseInt(port, 10), hostname, () => {
    const info = server.address();
    const serverPort =
      typeof info === "object" && info !== null ? info.port : port;
    console.log(`Server is running on http://${hostname}:${serverPort}`);
  });
};

const PlatformLayer = Layer.mergeAll(platformLayer, NodeContext.layer);

const SessionIndexLayer = SessionIndexService.Live;

const InfraMetaLayer = Layer.mergeAll(
  ProjectMetaService.Live,
  SessionMetaService.Live,
).pipe(Layer.provideMerge(SessionIndexLayer));

const InfraBasics = Layer.mergeAll(
  VirtualConversationDatabase.Live,
  SessionIndexLayer,
  InfraMetaLayer,
);

const InfraRepos = Layer.mergeAll(
  ProjectRepository.Live,
  SessionRepository.Live,
).pipe(Layer.provideMerge(InfraBasics));

const InfraLayer = Layer.mergeAll(InfraBasics, InfraRepos);

const DomainBase = Layer.mergeAll(
  CodexAppServerService.Live,
  CodexRpcClientService.Live,
  CodexSessionProcessService.Live,
  CodexApprovalService.Live,
  CodexService.Live,
  GitService.Live,
  SchedulerService.Live,
  SchedulerConfigBaseDir.Live,
  SearchService.Live,
  TasksService.Live,
);

const DomainLayer = CodexLifeCycleService.Live.pipe(
  Layer.provideMerge(DomainBase),
);

const AppServices = Layer.mergeAll(
  FileWatcherService.Live,
  AuthMiddleware.Live,
  TerminalService.Live,
);

const ApplicationLayer = InitializeService.Live.pipe(
  Layer.provideMerge(AppServices),
  Layer.provideMerge(InfraLayer),
);

const PresentationLayer = Layer.mergeAll(
  ProjectController.Live,
  SessionController.Live,
  GitController.Live,
  CodexController.Live,
  CodexSessionProcessController.Live,
  CodexPermissionController.Live,
  FileSystemController.Live,
  SSEController.Live,
  SchedulerController.Live,
  FeatureFlagController.Live,
  SearchController.Live,
  TasksController.Live,
);

const MainLayer = PresentationLayer.pipe(
  Layer.provideMerge(ApplicationLayer),
  Layer.provideMerge(DomainLayer),
  Layer.provideMerge(InfraLayer),
  Layer.provideMerge(PlatformLayer),
);
