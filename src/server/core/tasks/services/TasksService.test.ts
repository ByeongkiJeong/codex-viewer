import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { testFileSystemLayer } from "../../../../testing/layers/testFileSystemLayer";
import { testPlatformLayer } from "../../../../testing/layers/testPlatformLayer";
import { TasksService } from "./TasksService";

const projectId = "project-1";

describe("TasksService", () => {
  it("returns empty list when project task directory does not exist", async () => {
    const program = Effect.gen(function* () {
      const service = yield* TasksService;
      return yield* service.listTasks(projectId);
    });

    const result = await Effect.runPromise(
      program.pipe(
        Effect.provide(TasksService.Live),
        Effect.provide(
          testFileSystemLayer({
            exists: () => Effect.succeed(false),
          }),
        ),
        Effect.provide(testPlatformLayer()),
      ),
    );

    expect(result).toEqual([]);
  });

  it("merges tasks from all session directories when sessionId is omitted", async () => {
    const taskA = {
      id: "1",
      subject: "Task A",
      status: "pending",
      blocks: [],
      blockedBy: [],
    };
    const taskB = {
      id: "2",
      subject: "Task B",
      status: "in_progress",
      blocks: [],
      blockedBy: [],
    };

    const program = Effect.gen(function* () {
      const service = yield* TasksService;
      return yield* service.listTasks(projectId);
    });

    const result = await Effect.runPromise(
      program.pipe(
        Effect.provide(TasksService.Live),
        Effect.provide(
          testFileSystemLayer({
            exists: (path: string) =>
              Effect.succeed(
                path.endsWith("/tasks/project-1") ||
                  path.endsWith("/tasks/project-1/session-a") ||
                  path.endsWith("/tasks/project-1/session-b"),
              ),
            readDirectory: (path: string) => {
              if (path.endsWith("/tasks/project-1")) {
                return Effect.succeed(["session-a", "session-b"]);
              }
              if (path.endsWith("/tasks/project-1/session-a")) {
                return Effect.succeed(["1.json"]);
              }
              if (path.endsWith("/tasks/project-1/session-b")) {
                return Effect.succeed(["2.json"]);
              }
              return Effect.succeed([]);
            },
            readFileString: (path: string) => {
              if (path.endsWith("/tasks/project-1/session-a/1.json")) {
                return Effect.succeed(JSON.stringify(taskA));
              }
              if (path.endsWith("/tasks/project-1/session-b/2.json")) {
                return Effect.succeed(JSON.stringify(taskB));
              }
              return Effect.succeed(JSON.stringify(taskA));
            },
          }),
        ),
        Effect.provide(testPlatformLayer()),
      ),
    );

    expect(result.map((task) => task.id)).toEqual(["1", "2"]);
  });

  it("creates task in default session directory when sessionId is omitted", async () => {
    let createdPath = "";

    const program = Effect.gen(function* () {
      const service = yield* TasksService;
      return yield* service.createTask(projectId, {
        subject: "New task",
        description: "A task created without explicit session id",
      });
    });

    const result = await Effect.runPromise(
      program.pipe(
        Effect.provide(TasksService.Live),
        Effect.provide(
          testFileSystemLayer({
            exists: (path: string) =>
              Effect.succeed(path.endsWith("/tasks/project-1/default")),
            readDirectory: () => Effect.succeed([]),
            makeDirectory: () => Effect.void,
            writeFileString: (path: string) => {
              createdPath = path;
              return Effect.void;
            },
          }),
        ),
        Effect.provide(testPlatformLayer()),
      ),
    );

    expect(result.id).toBe("1");
    expect(result.subject).toBe("New task");
    expect(createdPath.endsWith("/tasks/project-1/default/1.json")).toBe(true);
  });

  it("fails update when task file does not exist", async () => {
    const program = Effect.gen(function* () {
      const service = yield* TasksService;
      return yield* service.updateTask(projectId, {
        taskId: "1",
        subject: "Updated task",
      });
    });

    const result = await Effect.runPromise(
      program.pipe(
        Effect.provide(TasksService.Live),
        Effect.provide(
          testFileSystemLayer({
            exists: () => Effect.succeed(false),
          }),
        ),
        Effect.provide(testPlatformLayer()),
        Effect.either,
      ),
    );

    expect(result._tag).toBe("Left");
  });
});
