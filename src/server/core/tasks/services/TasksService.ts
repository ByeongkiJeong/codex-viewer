import { FileSystem, Path } from "@effect/platform";
import { Context, Effect, Layer } from "effect";
import { ApplicationContext } from "../../platform/services/ApplicationContext";
import {
  type Task,
  type TaskCreate,
  TaskSchema,
  type TaskUpdate,
} from "../schema";

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null;
};

export class TasksService extends Context.Tag("TasksService")<
  TasksService,
  {
    listTasks: (
      projectId: string,
      specificSessionId?: string,
    ) => Effect.Effect<Task[], Error>;
    getTask: (
      projectId: string,
      taskId: string,
      specificSessionId?: string,
    ) => Effect.Effect<Task, Error>;
    createTask: (
      projectId: string,
      task: TaskCreate,
      specificSessionId?: string,
    ) => Effect.Effect<Task, Error>;
    updateTask: (
      projectId: string,
      task: TaskUpdate,
      specificSessionId?: string,
    ) => Effect.Effect<Task, Error>;
  }
>() {
  static Live = Layer.effect(
    this,
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const appContext = yield* ApplicationContext;

      const getProjectTasksDir = (projectId: string) =>
        Effect.gen(function* () {
          const codexTasksDirPath = (yield* appContext.codexPaths)
            .codexTasksDirPath;
          return path.join(codexTasksDirPath, projectId);
        });

      const getSessionTasksDir = (projectId: string, sessionId: string) =>
        Effect.gen(function* () {
          const projectTasksDir = yield* getProjectTasksDir(projectId);
          return path.join(projectTasksDir, sessionId);
        });

      const parseTaskFile = (filePath: string) =>
        Effect.gen(function* () {
          const content = yield* fs.readFileString(filePath);
          const json = yield* Effect.try({
            try: () => JSON.parse(content),
            catch: (error) =>
              error instanceof Error ? error : new Error(String(error)),
          });

          const parsed = TaskSchema.safeParse(json);
          if (parsed.success) {
            return parsed.data;
          }

          const fallbackId = path.basename(filePath).replace(/\.json$/, "");
          const fallbackTask: Task = {
            id:
              isRecord(json) && typeof json.id === "string"
                ? json.id
                : fallbackId,
            subject:
              isRecord(json) && typeof json.subject === "string"
                ? json.subject
                : "Invalid Task Schema",
            description: parsed.error.message,
            status: "failed",
            blocks: [],
            blockedBy: [],
          };

          return fallbackTask;
        });

      const listTasksInSessionDir = (sessionDirPath: string) =>
        Effect.gen(function* () {
          if (!(yield* fs.exists(sessionDirPath))) {
            return [] as Task[];
          }

          const files = yield* fs.readDirectory(sessionDirPath);
          const taskFiles = files.filter((file) => file.endsWith(".json"));

          const tasks = yield* Effect.all(
            taskFiles.map((file) =>
              parseTaskFile(path.join(sessionDirPath, file)).pipe(
                Effect.catchAll(() => Effect.succeed(null)),
              ),
            ),
            { concurrency: "unbounded" },
          );

          return tasks
            .filter((task): task is Task => task !== null)
            .toSorted((a, b) => {
              const aId = Number(a.id);
              const bId = Number(b.id);
              if (Number.isNaN(aId) || Number.isNaN(bId)) {
                return a.id.localeCompare(b.id);
              }
              return aId - bId;
            });
        });

      const resolveSessionIdForWrite = (
        specificSessionId: string | undefined,
      ) => {
        return specificSessionId ?? "default";
      };

      const listTasks = (projectId: string, specificSessionId?: string) =>
        Effect.gen(function* () {
          if (specificSessionId) {
            const sessionDir = yield* getSessionTasksDir(
              projectId,
              specificSessionId,
            );
            return yield* listTasksInSessionDir(sessionDir);
          }

          const projectDir = yield* getProjectTasksDir(projectId);
          if (!(yield* fs.exists(projectDir))) {
            return [] as Task[];
          }

          const sessionDirs = yield* fs.readDirectory(projectDir);
          const merged = yield* Effect.all(
            sessionDirs.map((sessionDirName) =>
              listTasksInSessionDir(path.join(projectDir, sessionDirName)).pipe(
                Effect.catchAll(() => Effect.succeed([])),
              ),
            ),
            { concurrency: "unbounded" },
          );

          return merged.flat().toSorted((a, b) => {
            const aId = Number(a.id);
            const bId = Number(b.id);
            if (Number.isNaN(aId) || Number.isNaN(bId)) {
              return a.id.localeCompare(b.id);
            }
            return aId - bId;
          });
        });

      const getTask = (
        projectId: string,
        taskId: string,
        specificSessionId?: string,
      ) =>
        Effect.gen(function* () {
          const sessionId = resolveSessionIdForWrite(specificSessionId);
          const sessionDir = yield* getSessionTasksDir(projectId, sessionId);
          const filePath = path.join(sessionDir, `${taskId}.json`);

          if (!(yield* fs.exists(filePath))) {
            return yield* Effect.fail(new Error(`Task ${taskId} not found`));
          }

          return yield* parseTaskFile(filePath);
        });

      const createTask = (
        projectId: string,
        task: TaskCreate,
        specificSessionId?: string,
      ) =>
        Effect.gen(function* () {
          const sessionId = resolveSessionIdForWrite(specificSessionId);
          const sessionDir = yield* getSessionTasksDir(projectId, sessionId);

          if (!(yield* fs.exists(sessionDir))) {
            yield* fs.makeDirectory(sessionDir, { recursive: true });
          }

          const existing = yield* listTasksInSessionDir(sessionDir);
          let maxId = 0;
          for (const existingTask of existing) {
            const current = Number(existingTask.id);
            if (!Number.isNaN(current) && current > maxId) {
              maxId = current;
            }
          }

          const nextId = String(maxId + 1);
          const nextTask: Task = {
            id: nextId,
            subject: task.subject,
            description: task.description,
            status: "pending",
            blocks: [],
            blockedBy: [],
            activeForm: task.activeForm,
            metadata: task.metadata,
          };

          yield* fs.writeFileString(
            path.join(sessionDir, `${nextId}.json`),
            JSON.stringify(nextTask, null, 2),
          );

          return nextTask;
        });

      const updateTask = (
        projectId: string,
        update: TaskUpdate,
        specificSessionId?: string,
      ) =>
        Effect.gen(function* () {
          const sessionId = resolveSessionIdForWrite(specificSessionId);
          const sessionDir = yield* getSessionTasksDir(projectId, sessionId);
          const filePath = path.join(sessionDir, `${update.taskId}.json`);

          if (!(yield* fs.exists(filePath))) {
            return yield* Effect.fail(
              new Error(`Task ${update.taskId} not found`),
            );
          }

          const currentTask = yield* parseTaskFile(filePath);

          const nextTask: Task = {
            ...currentTask,
            subject: update.subject ?? currentTask.subject,
            description: update.description ?? currentTask.description,
            status: update.status ?? currentTask.status,
            owner: update.owner ?? currentTask.owner,
            activeForm: update.activeForm ?? currentTask.activeForm,
            blockedBy: update.addBlockedBy
              ? [...(currentTask.blockedBy ?? []), ...update.addBlockedBy]
              : currentTask.blockedBy,
            blocks: update.addBlocks
              ? [...(currentTask.blocks ?? []), ...update.addBlocks]
              : currentTask.blocks,
            metadata: update.metadata
              ? { ...(currentTask.metadata ?? {}), ...update.metadata }
              : currentTask.metadata,
          };

          yield* fs.writeFileString(
            filePath,
            JSON.stringify(nextTask, null, 2),
          );

          return nextTask;
        });

      return {
        listTasks,
        getTask,
        createTask,
        updateTask,
      };
    }),
  );
}
