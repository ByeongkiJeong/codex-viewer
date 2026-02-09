import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeContext, NodeFileSystem, NodePath } from "@effect/platform-node";
import { Effect, Layer } from "effect";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { CodexLifeCycleService } from "../../codex-runtime/services/CodexLifeCycleService";
import { CodexSessionProcessService } from "../../codex-runtime/services/CodexSessionProcessService";
import { ProjectRepository } from "../../project/infrastructure/ProjectRepository";
import { SchedulerConfigBaseDir } from "../config";
import type { NewSchedulerJob } from "../schema";
import { SchedulerService } from "./Scheduler";

describe("SchedulerService", () => {
  let testDir: string;

  const mockSessionProcessService = Layer.succeed(
    CodexSessionProcessService,
    CodexSessionProcessService.of({
      startSessionProcess: () =>
        Effect.succeed({
          sessionProcess: {
            id: "sp-1",
            projectId: "project-1",
            sessionId: "thread-1",
            status: "running",
          },
        }),
      continueSessionProcess: () =>
        Effect.succeed({
          sessionProcess: {
            id: "sp-1",
            projectId: "project-1",
            sessionId: "thread-1",
            status: "running",
          },
        }),
      abortSessionProcess: () => Effect.void,
      getSessionProcesses: () => Effect.succeed([]),
      getSessionProcess: () =>
        Effect.succeed({
          id: "sp-1",
          projectId: "project-1",
          sessionId: "thread-1",
          cwd: "/tmp/test-project",
          status: "running",
          lastTurnId: null,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        }),
      handleRpcNotification: () => Effect.void,
      setAwaitingApproval: () => Effect.succeed(null),
      resumeAfterApproval: () => Effect.succeed(null),
    }),
  );

  const mockLifeCycleService = Layer.succeed(
    CodexLifeCycleService,
    CodexLifeCycleService.of({
      ensureStarted: () => Effect.void,
      getSessionProcesses: () => Effect.succeed([]),
      startSessionProcess: () =>
        Effect.succeed({
          sessionProcess: {
            id: "sp-1",
            projectId: "project-1",
            sessionId: "thread-1",
            status: "running",
          },
        }),
      continueSessionProcess: () =>
        Effect.succeed({
          sessionProcess: {
            id: "sp-1",
            projectId: "project-1",
            sessionId: "thread-1",
            status: "running",
          },
        }),
      abortTask: () => Effect.void,
      abortAllTasks: () => Effect.void,
    }),
  );

  const mockProjectRepository = Layer.succeed(
    ProjectRepository,
    ProjectRepository.of({
      getProject: () =>
        Effect.succeed({
          project: {
            id: "project-1",
            projectPath: "/tmp/test-project",
            lastModifiedAt: new Date(),
            meta: {
              projectName: "test-project",
              projectPath: "/tmp/test-project",
              sessionCount: 1,
            },
          },
        }),
      getProjects: () => Effect.succeed({ projects: [] }),
    }),
  );

  let testConfigBaseDir: Layer.Layer<SchedulerConfigBaseDir>;
  let testLayer: Layer.Layer<
    | import("@effect/platform").FileSystem.FileSystem
    | import("@effect/platform").Path.Path
    | import("@effect/platform-node").NodeContext.NodeContext
    | CodexSessionProcessService
    | CodexLifeCycleService
    | ProjectRepository
    | SchedulerConfigBaseDir
    | SchedulerService
  >;

  beforeEach(async () => {
    testDir = join(tmpdir(), `scheduler-test-${Date.now()}`);
    await mkdir(testDir, { recursive: true });

    testConfigBaseDir = Layer.succeed(SchedulerConfigBaseDir, testDir);

    const baseLayers = Layer.mergeAll(
      NodeFileSystem.layer,
      NodePath.layer,
      NodeContext.layer,
      mockSessionProcessService,
      mockLifeCycleService,
      mockProjectRepository,
      testConfigBaseDir,
    );

    testLayer = Layer.mergeAll(SchedulerService.Live, baseLayers).pipe(
      Layer.provideMerge(baseLayers),
    );
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  const buildJob = (): NewSchedulerJob => ({
    name: "Test Job",
    schedule: {
      type: "cron",
      expression: "0 0 * * *",
      concurrencyPolicy: "skip",
    },
    message: {
      content: "test message",
      projectId: "project-1",
      baseSession: null,
    },
    enabled: false,
  });

  test("addJob creates a new job with generated id", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const service = yield* SchedulerService;
        return yield* service.addJob(buildJob());
      }).pipe(Effect.provide(testLayer)),
    );

    expect(result.id).toBeDefined();
    expect(result.name).toBe("Test Job");
    expect(result.createdAt).toBeDefined();
    expect(result.lastRunAt).toBe(null);
    expect(result.lastRunStatus).toBe(null);
  });

  test("getJobs returns all jobs", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const service = yield* SchedulerService;
        yield* service.addJob(buildJob());
        yield* service.addJob(buildJob());
        return yield* service.getJobs();
      }).pipe(Effect.provide(testLayer)),
    );

    expect(result).toHaveLength(2);
  });

  test("updateJob modifies an existing job", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const service = yield* SchedulerService;
        const job = yield* service.addJob(buildJob());
        return yield* service.updateJob(job.id, { name: "Updated Job" });
      }).pipe(Effect.provide(testLayer)),
    );

    expect(result.name).toBe("Updated Job");
  });

  test("deleteJob removes a job", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const service = yield* SchedulerService;
        const job = yield* service.addJob(buildJob());
        yield* service.deleteJob(job.id);
        return yield* service.getJobs();
      }).pipe(Effect.provide(testLayer)),
    );

    expect(result).toHaveLength(0);
  });

  test("updateJob fails with SchedulerJobNotFoundError for non-existent job", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const service = yield* SchedulerService;
        return yield* service.updateJob("non-existent-id", { name: "Updated" });
      }).pipe(Effect.provide(testLayer), Effect.flip),
    );

    expect(result._tag).toBe("SchedulerJobNotFoundError");
  });

  test("deleteJob fails with SchedulerJobNotFoundError for non-existent job", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const service = yield* SchedulerService;
        return yield* service.deleteJob("non-existent-id");
      }).pipe(Effect.provide(testLayer), Effect.flip),
    );

    expect(result._tag).toBe("SchedulerJobNotFoundError");
  });
});
