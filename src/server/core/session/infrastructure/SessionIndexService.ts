import { FileSystem, Path } from "@effect/platform";
import { Context, Effect, Layer, Option } from "effect";
import {
  extractCwd,
  extractFirstUserInputText,
  extractLatestModelName,
  extractLatestTokenUsage,
  extractThreadId,
  type ParsedCodexLine,
  parseCodexJsonl,
} from "../../../../lib/codex-conversation-schema/parseCodexJsonl";
import { ApplicationContext } from "../../platform/services/ApplicationContext";

export type SessionIndexRecord = {
  threadId: string;
  cwd: string;
  jsonlFilePath: string;
  lastModifiedAt: Date;
  firstUserText: string | null;
  modelName: string | null;
  tokenUsage: {
    inputTokens: number;
    cachedInputTokens: number;
    outputTokens: number;
    reasoningOutputTokens: number;
    totalTokens: number;
  };
  lineCount: number;
  parsedLines: ParsedCodexLine[];
};

const rolloutPattern = /^rollout-.*\.jsonl$/;

interface SessionIndexServiceInterface {
  readonly getSessionIndices: () => Effect.Effect<SessionIndexRecord[], Error>;
  readonly getSessionByThreadId: (
    threadId: string,
  ) => Effect.Effect<SessionIndexRecord | null, Error>;
}

const LayerImpl = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const context = yield* ApplicationContext;

  const walkRolloutFiles = (dirPath: string): Effect.Effect<string[], Error> =>
    Effect.gen(function* () {
      const exists = yield* fs.exists(dirPath);
      if (!exists) {
        return [];
      }

      const entries = yield* fs.readDirectory(dirPath);
      const results = yield* Effect.all(
        entries.map((entry) =>
          Effect.gen(function* () {
            const fullPath = path.join(dirPath, entry);
            const stat = yield* fs
              .stat(fullPath)
              .pipe(Effect.catchAll(() => Effect.succeed(null)));

            if (stat === null) {
              return [];
            }

            if (stat.type === "Directory") {
              return yield* walkRolloutFiles(fullPath);
            }

            if (stat.type === "File" && rolloutPattern.test(entry)) {
              return [fullPath];
            }

            return [];
          }),
        ),
        { concurrency: "unbounded" },
      );

      return results.flat();
    });

  const loadIndexRecord = (jsonlFilePath: string) =>
    Effect.gen(function* () {
      const content = yield* fs.readFileString(jsonlFilePath);
      const parsedLines = parseCodexJsonl(content);
      const threadId = extractThreadId(parsedLines);
      const cwd = extractCwd(parsedLines);

      if (threadId === null || cwd === null) {
        return null;
      }

      const stat = yield* fs.stat(jsonlFilePath);

      return {
        threadId,
        cwd,
        jsonlFilePath,
        lastModifiedAt: Option.getOrElse(stat.mtime, () => new Date()),
        firstUserText: extractFirstUserInputText(parsedLines),
        modelName: extractLatestModelName(parsedLines),
        tokenUsage: extractLatestTokenUsage(parsedLines),
        lineCount: parsedLines.length,
        parsedLines,
      } satisfies SessionIndexRecord;
    });

  const getSessionIndices = (): Effect.Effect<SessionIndexRecord[], Error> =>
    Effect.gen(function* () {
      const sessionsRoot = (yield* context.codexPaths).codexSessionsDirPath;
      const files = yield* walkRolloutFiles(sessionsRoot);

      const records = yield* Effect.all(
        files.map((file) =>
          loadIndexRecord(file).pipe(
            Effect.catchAll(() => Effect.succeed(null)),
          ),
        ),
        { concurrency: 20 },
      );

      return records
        .filter((item): item is SessionIndexRecord => item !== null)
        .toSorted(
          (a, b) => b.lastModifiedAt.getTime() - a.lastModifiedAt.getTime(),
        );
    });

  const getSessionByThreadId = (
    threadId: string,
  ): Effect.Effect<SessionIndexRecord | null, Error> =>
    Effect.gen(function* () {
      const records = yield* getSessionIndices();
      return records.find((record) => record.threadId === threadId) ?? null;
    });

  return {
    getSessionIndices,
    getSessionByThreadId,
  } satisfies SessionIndexServiceInterface;
});

export type ISessionIndexService = SessionIndexServiceInterface;
export class SessionIndexService extends Context.Tag("SessionIndexService")<
  SessionIndexService,
  ISessionIndexService
>() {
  static Live = Layer.effect(this, LayerImpl);
}
