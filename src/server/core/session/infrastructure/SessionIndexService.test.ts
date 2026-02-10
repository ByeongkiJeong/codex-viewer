import { FileSystem } from "@effect/platform";
import { Effect, Option } from "effect";
import { describe, expect, it } from "vitest";
import {
  createFileInfo,
  testFileSystemLayer,
} from "../../../../testing/layers/testFileSystemLayer";
import { testPersistentServiceLayer } from "../../../../testing/layers/testPersistentServiceLayer";
import { testPlatformLayer } from "../../../../testing/layers/testPlatformLayer";
import { SessionIndexService } from "./SessionIndexService";

const sessionsRootPath = "/sessions";
const yearPath = "/sessions/2026";
const monthPath = "/sessions/2026/02";
const dayPath = "/sessions/2026/02/10";
const rolloutFilePath = "/sessions/2026/02/10/rollout-1.jsonl";

const rolloutContent = [
  JSON.stringify({
    timestamp: "2026-02-10T00:00:00.000Z",
    type: "session_meta",
    payload: {
      id: "thread-1",
      timestamp: "2026-02-10T00:00:00.000Z",
      cwd: "/tmp/project-a",
    },
  }),
  JSON.stringify({
    timestamp: "2026-02-10T00:00:01.000Z",
    type: "response_item",
    payload: {
      type: "message",
      role: "user",
      content: [{ type: "input_text", text: "hello" }],
    },
  }),
].join("\n");

const makeFileSystemLayer = (options: {
  statByPath: Map<string, FileSystem.File.Info>;
  onReadFileString?: () => void;
}) => {
  const directoryEntries = new Map<string, Array<string>>([
    [sessionsRootPath, ["2026"]],
    [yearPath, ["02"]],
    [monthPath, ["10"]],
    [dayPath, ["rollout-1.jsonl"]],
  ]);

  return testFileSystemLayer({
    exists: (path) =>
      Effect.succeed(directoryEntries.has(path) || path === rolloutFilePath),
    readDirectory: (path) => Effect.succeed(directoryEntries.get(path) ?? []),
    stat: (path) =>
      Effect.succeed(
        options.statByPath.get(path) ??
          createFileInfo({
            type: "Directory",
            size: FileSystem.Size(0n),
          }),
      ),
    readFileString: () => {
      options.onReadFileString?.();
      return Effect.succeed(rolloutContent);
    },
  });
};

describe("SessionIndexService", () => {
  it("reuses persisted metadata for unchanged files without reparsing jsonl", async () => {
    let readFileCount = 0;
    const mtime = new Date("2026-02-10T00:00:00.000Z");

    const statByPath = new Map<string, FileSystem.File.Info>([
      [
        rolloutFilePath,
        createFileInfo({
          type: "File",
          mtime: Option.some(mtime),
          size: FileSystem.Size(123n),
        }),
      ],
    ]);

    const program = Effect.gen(function* () {
      const service = yield* SessionIndexService;
      return yield* service.getSessionIndices();
    });

    const result = await Effect.runPromise(
      program.pipe(
        Effect.provide(SessionIndexService.Live),
        Effect.provide(
          makeFileSystemLayer({
            statByPath,
            onReadFileString: () => {
              readFileCount += 1;
            },
          }),
        ),
        Effect.provide(
          testPersistentServiceLayer({
            savedEntries: [
              [
                rolloutFilePath,
                {
                  fingerprint: {
                    mtimeMs: mtime.getTime(),
                    sizeBytes: "123",
                  },
                  record: {
                    threadId: "thread-1",
                    cwd: "/tmp/project-a",
                    jsonlFilePath: rolloutFilePath,
                    lastModifiedAt: mtime.toISOString(),
                    firstUserText: "hello",
                    modelName: "gpt-5-codex",
                    tokenUsage: {
                      inputTokens: 0,
                      cachedInputTokens: 0,
                      outputTokens: 0,
                      reasoningOutputTokens: 0,
                      totalTokens: 0,
                    },
                    lineCount: 2,
                  },
                },
              ],
            ],
          }),
        ),
        Effect.provide(
          testPlatformLayer({
            codexPaths: {
              codexSessionsDirPath: sessionsRootPath,
            },
          }),
        ),
      ),
    );

    expect(result).toHaveLength(1);
    expect(result[0]?.threadId).toBe("thread-1");
    expect(readFileCount).toBe(0);
  });

  it("parses unchanged rollout files only once across repeated reads", async () => {
    let readFileCount = 0;
    const mtime = new Date("2026-02-10T00:00:00.000Z");

    const statByPath = new Map<string, FileSystem.File.Info>([
      [
        rolloutFilePath,
        createFileInfo({
          type: "File",
          mtime: Option.some(mtime),
          size: FileSystem.Size(123n),
        }),
      ],
    ]);

    const program = Effect.gen(function* () {
      const service = yield* SessionIndexService;
      yield* service.getSessionIndices();
      return yield* service.getSessionIndices();
    });

    const result = await Effect.runPromise(
      program.pipe(
        Effect.provide(SessionIndexService.Live),
        Effect.provide(
          makeFileSystemLayer({
            statByPath,
            onReadFileString: () => {
              readFileCount += 1;
            },
          }),
        ),
        Effect.provide(testPersistentServiceLayer()),
        Effect.provide(
          testPlatformLayer({
            codexPaths: {
              codexSessionsDirPath: sessionsRootPath,
            },
          }),
        ),
      ),
    );

    expect(result).toHaveLength(1);
    expect(readFileCount).toBe(1);
  });
});
