import { FileSystem, Path } from "@effect/platform";
import { Context, Effect, Layer, Option, Ref } from "effect";
import { z } from "zod";
import {
  extractCwd,
  extractFirstUserInputText,
  extractLatestModelName,
  extractLatestTokenUsage,
  extractThreadId,
  type ParsedCodexLine,
  parseCodexJsonl,
} from "../../../../lib/codex-conversation-schema/parseCodexJsonl";
import { PersistentService } from "../../../lib/storage/FileCacheStorage/PersistentService";
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

type SessionIndexMetadataRecord = Omit<SessionIndexRecord, "parsedLines">;

type FileFingerprint = {
  mtimeMs: number;
  sizeBytes: string;
};

type CachedMetadataEntry = {
  fingerprint: FileFingerprint;
  record: SessionIndexMetadataRecord;
};

type ParsedLinesCacheEntry = {
  fingerprint: FileFingerprint;
  parsedLines: ParsedCodexLine[];
};

type RolloutFile = {
  filePath: string;
  fileInfo: FileSystem.File.Info;
};

const rolloutPattern = /^rollout-.*\.jsonl$/;
const sessionIndexCacheKey = "session-index-v1";
const refreshMinimumIntervalMs = 1_000;

const tokenUsageSchema = z.object({
  inputTokens: z.number(),
  cachedInputTokens: z.number(),
  outputTokens: z.number(),
  reasoningOutputTokens: z.number(),
  totalTokens: z.number(),
});

const persistedEntrySchema = z.object({
  fingerprint: z.object({
    mtimeMs: z.number(),
    sizeBytes: z.string(),
  }),
  record: z.object({
    threadId: z.string(),
    cwd: z.string(),
    jsonlFilePath: z.string(),
    lastModifiedAt: z.string(),
    firstUserText: z.string().nullable(),
    modelName: z.string().nullable(),
    tokenUsage: tokenUsageSchema,
    lineCount: z.number(),
  }),
});

interface SessionIndexServiceInterface {
  readonly getSessionIndices: () => Effect.Effect<SessionIndexRecord[], Error>;
  readonly getSessionIndicesWithParsedLines: () => Effect.Effect<
    SessionIndexRecord[],
    Error
  >;
  readonly getSessionByThreadId: (
    threadId: string,
  ) => Effect.Effect<SessionIndexRecord | null, Error>;
  readonly getSessionByThreadIdWithParsedLines: (
    threadId: string,
  ) => Effect.Effect<SessionIndexRecord | null, Error>;
  readonly warmSessionIndexCache: () => Effect.Effect<void, Error>;
}

const LayerImpl = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const context = yield* ApplicationContext;
  const persistentService = yield* PersistentService;

  const fileFingerprintFromInfo = (
    fileInfo: FileSystem.File.Info,
  ): FileFingerprint => ({
    mtimeMs: Option.getOrElse(fileInfo.mtime, () => new Date(0)).getTime(),
    sizeBytes: fileInfo.size.toString(),
  });

  const hasSameFingerprint = (
    left: FileFingerprint,
    right: FileFingerprint,
  ): boolean => {
    return left.mtimeMs === right.mtimeMs && left.sizeBytes === right.sizeBytes;
  };

  const sortByLastModified = (
    records: readonly SessionIndexMetadataRecord[],
  ): SessionIndexMetadataRecord[] => {
    return [...records].toSorted(
      (a, b) => b.lastModifiedAt.getTime() - a.lastModifiedAt.getTime(),
    );
  };

  const loadPersistedMetadata = (): Effect.Effect<
    Map<string, CachedMetadataEntry>
  > =>
    Effect.gen(function* () {
      const persisted = yield* persistentService
        .load(sessionIndexCacheKey)
        .pipe(
          Effect.provideService(FileSystem.FileSystem, fs),
          Effect.catchAll(() => Effect.succeed([])),
        );
      const map = new Map<string, CachedMetadataEntry>();

      for (const [, persistedValue] of persisted) {
        const parsed = persistedEntrySchema.safeParse(persistedValue);
        if (!parsed.success) {
          continue;
        }

        const parsedDate = new Date(parsed.data.record.lastModifiedAt);
        if (Number.isNaN(parsedDate.getTime())) {
          continue;
        }

        const record: SessionIndexMetadataRecord = {
          threadId: parsed.data.record.threadId,
          cwd: parsed.data.record.cwd,
          jsonlFilePath: parsed.data.record.jsonlFilePath,
          lastModifiedAt: parsedDate,
          firstUserText: parsed.data.record.firstUserText,
          modelName: parsed.data.record.modelName,
          tokenUsage: parsed.data.record.tokenUsage,
          lineCount: parsed.data.record.lineCount,
        };

        map.set(record.jsonlFilePath, {
          fingerprint: parsed.data.fingerprint,
          record,
        });
      }

      return map;
    });

  const savePersistedMetadata = (map: Map<string, CachedMetadataEntry>) => {
    const serialized: Array<[string, unknown]> = [];
    for (const [filePath, entry] of map.entries()) {
      serialized.push([
        filePath,
        {
          fingerprint: entry.fingerprint,
          record: {
            threadId: entry.record.threadId,
            cwd: entry.record.cwd,
            jsonlFilePath: entry.record.jsonlFilePath,
            lastModifiedAt: entry.record.lastModifiedAt.toISOString(),
            firstUserText: entry.record.firstUserText,
            modelName: entry.record.modelName,
            tokenUsage: entry.record.tokenUsage,
            lineCount: entry.record.lineCount,
          },
        },
      ]);
    }

    return persistentService.save(sessionIndexCacheKey, serialized).pipe(
      Effect.provideService(FileSystem.FileSystem, fs),
      Effect.catchAll(() => Effect.void),
    );
  };

  const walkRolloutFiles = (
    dirPath: string,
  ): Effect.Effect<RolloutFile[], Error> =>
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
              return [{ filePath: fullPath, fileInfo: stat }];
            }

            return [];
          }),
        ),
        { concurrency: "unbounded" },
      );

      return results.flat();
    });

  const loadIndexMetadata = (rolloutFile: RolloutFile) =>
    Effect.gen(function* () {
      const content = yield* fs.readFileString(rolloutFile.filePath);
      const parsedLines = parseCodexJsonl(content);
      const threadId = extractThreadId(parsedLines);
      const cwd = extractCwd(parsedLines);

      if (threadId === null || cwd === null) {
        return null;
      }

      return {
        threadId,
        cwd,
        jsonlFilePath: rolloutFile.filePath,
        lastModifiedAt: Option.getOrElse(
          rolloutFile.fileInfo.mtime,
          () => new Date(),
        ),
        firstUserText: extractFirstUserInputText(parsedLines),
        modelName: extractLatestModelName(parsedLines),
        tokenUsage: extractLatestTokenUsage(parsedLines),
        lineCount: parsedLines.length,
      } satisfies SessionIndexMetadataRecord;
    });

  const readParsedLines = (
    jsonlFilePath: string,
  ): Effect.Effect<ParsedCodexLine[], Error> =>
    Effect.gen(function* () {
      const content = yield* fs.readFileString(jsonlFilePath);
      return parseCodexJsonl(content);
    });

  const updateThreadIndex = (
    metadataMap: Map<string, CachedMetadataEntry>,
  ): Map<string, string> => {
    const map = new Map<string, string>();
    for (const [filePath, entry] of metadataMap.entries()) {
      map.set(entry.record.threadId, filePath);
    }
    return map;
  };

  const initialMetadataMap = yield* loadPersistedMetadata();
  const metadataCacheRef = yield* Ref.make(initialMetadataMap);
  const parsedLinesCacheRef = yield* Ref.make(
    new Map<string, ParsedLinesCacheEntry>(),
  );
  const threadToFilePathRef = yield* Ref.make(
    updateThreadIndex(initialMetadataMap),
  );
  const lastRefreshAtRef = yield* Ref.make(0);

  const removeFileFromCaches = (filePath: string): Effect.Effect<void, Error> =>
    Effect.gen(function* () {
      const metadataMap = yield* Ref.get(metadataCacheRef);
      if (!metadataMap.has(filePath)) {
        return;
      }

      const nextMetadata = new Map(metadataMap);
      const removedEntry = nextMetadata.get(filePath);
      nextMetadata.delete(filePath);

      const nextParsed = new Map(yield* Ref.get(parsedLinesCacheRef));
      nextParsed.delete(filePath);

      const nextThreadIndex = new Map(yield* Ref.get(threadToFilePathRef));
      if (removedEntry !== undefined) {
        nextThreadIndex.delete(removedEntry.record.threadId);
      }

      yield* Ref.set(metadataCacheRef, nextMetadata);
      yield* Ref.set(parsedLinesCacheRef, nextParsed);
      yield* Ref.set(threadToFilePathRef, nextThreadIndex);
      yield* savePersistedMetadata(nextMetadata);
    });

  const upsertMetadataEntry = (
    filePath: string,
    entry: CachedMetadataEntry,
  ): Effect.Effect<void, Error> =>
    Effect.gen(function* () {
      const metadataMap = yield* Ref.get(metadataCacheRef);
      const previousEntry = metadataMap.get(filePath);
      const nextMetadata = new Map(metadataMap);
      nextMetadata.set(filePath, entry);

      const nextThreadIndex = new Map(yield* Ref.get(threadToFilePathRef));
      if (
        previousEntry !== undefined &&
        previousEntry.record.threadId !== entry.record.threadId
      ) {
        nextThreadIndex.delete(previousEntry.record.threadId);
      }
      nextThreadIndex.set(entry.record.threadId, filePath);

      const nextParsed = new Map(yield* Ref.get(parsedLinesCacheRef));
      if (
        previousEntry === undefined ||
        !hasSameFingerprint(previousEntry.fingerprint, entry.fingerprint)
      ) {
        nextParsed.delete(filePath);
      }

      yield* Ref.set(metadataCacheRef, nextMetadata);
      yield* Ref.set(threadToFilePathRef, nextThreadIndex);
      yield* Ref.set(parsedLinesCacheRef, nextParsed);
      yield* savePersistedMetadata(nextMetadata);
    });

  const refreshMetadataCache = (options?: {
    force?: boolean;
  }): Effect.Effect<SessionIndexMetadataRecord[], Error> =>
    Effect.gen(function* () {
      const force = options?.force ?? false;
      if (!force) {
        const lastRefreshAt = yield* Ref.get(lastRefreshAtRef);
        const now = Date.now();
        if (now - lastRefreshAt < refreshMinimumIntervalMs) {
          const metadataMap = yield* Ref.get(metadataCacheRef);
          return sortByLastModified(
            Array.from(metadataMap.values()).map((entry) => entry.record),
          );
        }
      }

      const sessionsRoot = (yield* context.codexPaths).codexSessionsDirPath;
      const rolloutFiles = yield* walkRolloutFiles(sessionsRoot);
      const currentMetadataMap = yield* Ref.get(metadataCacheRef);

      const refreshedEntries = yield* Effect.all(
        rolloutFiles.map((rolloutFile) =>
          Effect.gen(function* () {
            const fingerprint = fileFingerprintFromInfo(rolloutFile.fileInfo);
            const cached = currentMetadataMap.get(rolloutFile.filePath);
            if (
              cached !== undefined &&
              hasSameFingerprint(cached.fingerprint, fingerprint)
            ) {
              return {
                filePath: rolloutFile.filePath,
                entry: cached,
              };
            }

            const loaded = yield* loadIndexMetadata(rolloutFile).pipe(
              Effect.catchAll(() => Effect.succeed(null)),
            );
            if (loaded === null) {
              return null;
            }

            return {
              filePath: rolloutFile.filePath,
              entry: {
                fingerprint,
                record: loaded,
              } satisfies CachedMetadataEntry,
            };
          }),
        ),
        { concurrency: 20 },
      );

      const nextMetadata = new Map<string, CachedMetadataEntry>();
      for (const refreshedEntry of refreshedEntries) {
        if (refreshedEntry === null) {
          continue;
        }
        nextMetadata.set(refreshedEntry.filePath, refreshedEntry.entry);
      }

      const nextParsed = new Map(yield* Ref.get(parsedLinesCacheRef));
      for (const [filePath, parsedEntry] of nextParsed.entries()) {
        const metadataEntry = nextMetadata.get(filePath);
        if (
          metadataEntry === undefined ||
          !hasSameFingerprint(
            metadataEntry.fingerprint,
            parsedEntry.fingerprint,
          )
        ) {
          nextParsed.delete(filePath);
        }
      }

      yield* Ref.set(metadataCacheRef, nextMetadata);
      yield* Ref.set(threadToFilePathRef, updateThreadIndex(nextMetadata));
      yield* Ref.set(parsedLinesCacheRef, nextParsed);
      yield* Ref.set(lastRefreshAtRef, Date.now());
      yield* savePersistedMetadata(nextMetadata);

      return sortByLastModified(
        Array.from(nextMetadata.values()).map((entry) => entry.record),
      );
    });

  const lookupMetadataByThreadId = (
    threadId: string,
  ): Effect.Effect<SessionIndexMetadataRecord | null, Error> =>
    Effect.gen(function* () {
      const threadToFilePath = yield* Ref.get(threadToFilePathRef);
      const filePath = threadToFilePath.get(threadId);
      if (filePath === undefined) {
        return null;
      }

      const metadataMap = yield* Ref.get(metadataCacheRef);
      const entry = metadataMap.get(filePath);
      return entry?.record ?? null;
    });

  const getRecordWithParsedLines = (
    metadataRecord: SessionIndexMetadataRecord,
  ): Effect.Effect<SessionIndexRecord | null, Error> =>
    Effect.gen(function* () {
      const stat = yield* fs
        .stat(metadataRecord.jsonlFilePath)
        .pipe(Effect.catchAll(() => Effect.succeed(null)));

      if (stat === null) {
        yield* removeFileFromCaches(metadataRecord.jsonlFilePath);
        return null;
      }

      const fileFingerprint = fileFingerprintFromInfo(stat);
      const metadataMap = yield* Ref.get(metadataCacheRef);
      const cachedMetadata = metadataMap.get(metadataRecord.jsonlFilePath);

      const currentMetadata =
        cachedMetadata !== undefined &&
        hasSameFingerprint(cachedMetadata.fingerprint, fileFingerprint)
          ? cachedMetadata.record
          : yield* Effect.gen(function* () {
              const loaded = yield* loadIndexMetadata({
                filePath: metadataRecord.jsonlFilePath,
                fileInfo: stat,
              }).pipe(Effect.catchAll(() => Effect.succeed(null)));
              if (loaded === null) {
                return null;
              }

              yield* upsertMetadataEntry(metadataRecord.jsonlFilePath, {
                fingerprint: fileFingerprint,
                record: loaded,
              });
              return loaded;
            });

      if (currentMetadata === null) {
        yield* removeFileFromCaches(metadataRecord.jsonlFilePath);
        return null;
      }

      const parsedCache = yield* Ref.get(parsedLinesCacheRef);
      const cachedParsed = parsedCache.get(currentMetadata.jsonlFilePath);
      const parsedLines =
        cachedParsed !== undefined &&
        hasSameFingerprint(cachedParsed.fingerprint, fileFingerprint)
          ? cachedParsed.parsedLines
          : yield* Effect.gen(function* () {
              const lines = yield* readParsedLines(
                currentMetadata.jsonlFilePath,
              );
              const nextParsed = new Map(yield* Ref.get(parsedLinesCacheRef));
              nextParsed.set(currentMetadata.jsonlFilePath, {
                fingerprint: fileFingerprint,
                parsedLines: lines,
              });
              yield* Ref.set(parsedLinesCacheRef, nextParsed);
              return lines;
            });

      return {
        ...currentMetadata,
        parsedLines,
      };
    });

  const getSessionIndices = (): Effect.Effect<SessionIndexRecord[], Error> =>
    Effect.gen(function* () {
      const refreshed = yield* refreshMetadataCache();
      return refreshed.map((record) => ({
        ...record,
        parsedLines: [],
      }));
    });

  const getSessionIndicesWithParsedLines = (): Effect.Effect<
    SessionIndexRecord[],
    Error
  > =>
    Effect.gen(function* () {
      const refreshed = yield* refreshMetadataCache();
      const records = yield* Effect.all(
        refreshed.map((record) =>
          getRecordWithParsedLines(record).pipe(
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
      yield* refreshMetadataCache();
      const cached = yield* lookupMetadataByThreadId(threadId);
      if (cached !== null) {
        return {
          ...cached,
          parsedLines: [],
        };
      }

      yield* refreshMetadataCache({ force: true });
      const refreshed = yield* lookupMetadataByThreadId(threadId);
      if (refreshed === null) {
        return null;
      }

      return {
        ...refreshed,
        parsedLines: [],
      };
    });

  const getSessionByThreadIdWithParsedLines = (
    threadId: string,
  ): Effect.Effect<SessionIndexRecord | null, Error> =>
    Effect.gen(function* () {
      const cached = yield* lookupMetadataByThreadId(threadId);
      if (cached !== null) {
        return yield* getRecordWithParsedLines(cached);
      }

      yield* refreshMetadataCache({ force: true });
      const refreshed = yield* lookupMetadataByThreadId(threadId);
      if (refreshed === null) {
        return null;
      }
      return yield* getRecordWithParsedLines(refreshed);
    });

  const warmSessionIndexCache = (): Effect.Effect<void, Error> =>
    refreshMetadataCache({ force: true }).pipe(Effect.asVoid);

  return {
    getSessionIndices,
    getSessionIndicesWithParsedLines,
    getSessionByThreadId,
    getSessionByThreadIdWithParsedLines,
    warmSessionIndexCache,
  } satisfies SessionIndexServiceInterface;
});

export type ISessionIndexService = SessionIndexServiceInterface;
export class SessionIndexService extends Context.Tag("SessionIndexService")<
  SessionIndexService,
  ISessionIndexService
>() {
  static Live = Layer.effect(this, LayerImpl);
}
