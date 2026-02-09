import { type FSWatcher, watch } from "node:fs";
import { FileSystem, Path } from "@effect/platform";
import { Context, Effect, Layer, Ref } from "effect";
import {
  extractCwd,
  parseCodexJsonl,
} from "../../../../lib/codex-conversation-schema/parseCodexJsonl";
import { ApplicationContext } from "../../platform/services/ApplicationContext";
import { encodeProjectId } from "../../project/functions/id";
import { parseSessionFilePath } from "../functions/parseSessionFilePath";
import { EventBus } from "./EventBus";

interface FileWatcherServiceInterface {
  readonly startWatching: () => Effect.Effect<void>;
  readonly stop: () => Effect.Effect<void>;
}

export class FileWatcherService extends Context.Tag("FileWatcherService")<
  FileWatcherService,
  FileWatcherServiceInterface
>() {
  static Live = Layer.effect(
    this,
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const eventBus = yield* EventBus;
      const context = yield* ApplicationContext;

      const isWatchingRef = yield* Ref.make(false);
      const watcherRef = yield* Ref.make<FSWatcher | null>(null);
      const debounceTimersRef = yield* Ref.make<
        Map<string, ReturnType<typeof setTimeout>>
      >(new Map());

      const startWatching = (): Effect.Effect<void> =>
        Effect.gen(function* () {
          const isWatching = yield* Ref.get(isWatchingRef);
          if (isWatching) {
            return;
          }

          const codexPaths = yield* context.codexPaths;
          yield* Ref.set(isWatchingRef, true);

          yield* Effect.tryPromise({
            try: async () => {
              console.log(
                "Starting file watcher on:",
                codexPaths.codexSessionsDirPath,
              );

              const watcher = watch(
                codexPaths.codexSessionsDirPath,
                { persistent: false, recursive: true },
                (_eventType, filename) => {
                  if (!filename) {
                    return;
                  }

                  const fileMatch = parseSessionFilePath(filename);
                  if (fileMatch === null) {
                    return;
                  }

                  const debounceKey = fileMatch.threadId;

                  Effect.runPromise(
                    Effect.gen(function* () {
                      const timers = yield* Ref.get(debounceTimersRef);
                      const existing = timers.get(debounceKey);
                      if (existing !== undefined) {
                        clearTimeout(existing);
                      }

                      const fullPath = path.join(
                        codexPaths.codexSessionsDirPath,
                        filename,
                      );

                      const timer = setTimeout(() => {
                        Effect.runFork(
                          Effect.gen(function* () {
                            const content = yield* fs
                              .readFileString(fullPath)
                              .pipe(Effect.catchAll(() => Effect.succeed("")));
                            if (content.length === 0) {
                              return;
                            }

                            const parsed = parseCodexJsonl(content);
                            const cwd = extractCwd(parsed);
                            if (cwd === null) {
                              return;
                            }

                            const projectId = encodeProjectId(cwd);

                            yield* eventBus.emit("sessionChanged", {
                              projectId,
                              sessionId: fileMatch.threadId,
                            });

                            yield* eventBus.emit("sessionListChanged", {
                              projectId,
                            });
                          }),
                        );

                        Effect.runFork(
                          Ref.update(debounceTimersRef, (current) => {
                            const next = new Map(current);
                            next.delete(debounceKey);
                            return next;
                          }),
                        );
                      }, 120);

                      timers.set(debounceKey, timer);
                      yield* Ref.set(debounceTimersRef, timers);
                    }),
                  );
                },
              );

              await Effect.runPromise(Ref.set(watcherRef, watcher));
              console.log("File watcher initialization completed");
            },
            catch: (error) => {
              console.error("Failed to start file watching:", error);
              return new Error(
                `Failed to start file watching: ${String(error)}`,
              );
            },
          }).pipe(Effect.catchAll(() => Effect.void));
        });

      const stop = (): Effect.Effect<void> =>
        Effect.gen(function* () {
          const timers = yield* Ref.get(debounceTimersRef);
          for (const [, timer] of timers) {
            clearTimeout(timer);
          }
          yield* Ref.set(debounceTimersRef, new Map());

          const watcher = yield* Ref.get(watcherRef);
          if (watcher !== null) {
            watcher.close();
            yield* Ref.set(watcherRef, null);
          }

          yield* Ref.set(isWatchingRef, false);
        });

      return {
        startWatching,
        stop,
      } satisfies FileWatcherServiceInterface;
    }),
  );
}
