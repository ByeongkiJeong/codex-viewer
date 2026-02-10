import { Effect, Layer, Ref } from "effect";
import { describe, expect, it } from "vitest";
import { SessionIndexService } from "../infrastructure/SessionIndexService";
import { SessionMetaService } from "./SessionMetaService";

const makeSessionIndexRecord = (options: {
  threadId: string;
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
}) => {
  return {
    ...options,
    cwd: "/test/project",
    jsonlFilePath: `/test/project/${options.threadId}.jsonl`,
    lastModifiedAt: new Date("2026-01-01T00:00:00.000Z"),
    parsedLines: [],
  };
};

const makeSessionIndexLayer = (options: {
  record: null | {
    threadId: string;
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
  };
  onGet?: () => void;
}) => {
  return Layer.succeed(
    SessionIndexService,
    SessionIndexService.of({
      getSessionIndices: () => Effect.succeed([]),
      getSessionIndicesWithParsedLines: () => Effect.succeed([]),
      getSessionByThreadId: (_threadId: string) => {
        options.onGet?.();
        return Effect.succeed(
          options.record === null
            ? null
            : makeSessionIndexRecord(options.record),
        );
      },
      getSessionByThreadIdWithParsedLines: (_threadId: string) => {
        options.onGet?.();
        return Effect.succeed(
          options.record === null
            ? null
            : makeSessionIndexRecord(options.record),
        );
      },
      warmSessionIndexCache: () => Effect.void,
    }),
  );
};

describe("SessionMetaService", () => {
  it("builds token-based session metadata from session index", async () => {
    const testLayer = SessionMetaService.Live.pipe(
      Layer.provide(
        makeSessionIndexLayer({
          record: {
            threadId: "thread-1",
            firstUserText: "hello codex",
            modelName: "gpt-5-codex",
            tokenUsage: {
              inputTokens: 100,
              cachedInputTokens: 20,
              outputTokens: 50,
              reasoningOutputTokens: 10,
              totalTokens: 160,
            },
            lineCount: 12,
          },
        }),
      ),
    );

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const service = yield* SessionMetaService;
        return yield* service.getSessionMeta("project-1", "thread-1");
      }).pipe(Effect.provide(testLayer)),
    );

    expect(result.messageCount).toBe(12);
    expect(result.modelName).toBe("gpt-5-codex");
    expect(result.tokenUsage.totalTokens).toBe(160);
    expect(result.firstUserMessage).toEqual({
      kind: "text",
      content: "hello codex",
    });
  });

  it("caches metadata results and reuses them", async () => {
    const callsRef = await Effect.runPromise(Ref.make(0));

    const testLayer = SessionMetaService.Live.pipe(
      Layer.provide(
        makeSessionIndexLayer({
          record: {
            threadId: "thread-2",
            firstUserText: "test",
            modelName: null,
            tokenUsage: {
              inputTokens: 1,
              cachedInputTokens: 0,
              outputTokens: 1,
              reasoningOutputTokens: 0,
              totalTokens: 2,
            },
            lineCount: 2,
          },
          onGet: () => {
            Effect.runSync(Ref.update(callsRef, (count) => count + 1));
          },
        }),
      ),
    );

    await Effect.runPromise(
      Effect.gen(function* () {
        const service = yield* SessionMetaService;
        yield* service.getSessionMeta("project-1", "thread-2");
        yield* service.getSessionMeta("project-1", "thread-2");
      }).pipe(Effect.provide(testLayer)),
    );

    const calls = await Effect.runPromise(Ref.get(callsRef));
    expect(calls).toBe(1);
  });

  it("invalidates cached session metadata", async () => {
    const callCount = await Effect.runPromise(Ref.make(0));

    const testLayer = SessionMetaService.Live.pipe(
      Layer.provide(
        makeSessionIndexLayer({
          record: {
            threadId: "thread-3",
            firstUserText: "message",
            modelName: null,
            tokenUsage: {
              inputTokens: 10,
              cachedInputTokens: 0,
              outputTokens: 5,
              reasoningOutputTokens: 0,
              totalTokens: 15,
            },
            lineCount: 3,
          },
          onGet: () => {
            Effect.runSync(Ref.update(callCount, (count) => count + 1));
          },
        }),
      ),
    );

    await Effect.runPromise(
      Effect.gen(function* () {
        const service = yield* SessionMetaService;
        yield* service.getSessionMeta("project-1", "thread-3");
        yield* service.invalidateSession("project-1", "thread-3");
        yield* service.getSessionMeta("project-1", "thread-3");
      }).pipe(Effect.provide(testLayer)),
    );

    const calls = await Effect.runPromise(Ref.get(callCount));
    expect(calls).toBe(2);
  });

  it("fails when session is missing", async () => {
    const testLayer = SessionMetaService.Live.pipe(
      Layer.provide(makeSessionIndexLayer({ record: null })),
    );

    await expect(
      Effect.runPromise(
        Effect.gen(function* () {
          const service = yield* SessionMetaService;
          return yield* service.getSessionMeta("project-1", "missing-thread");
        }).pipe(Effect.provide(testLayer)),
      ),
    ).rejects.toThrow("Session not found");
  });
});
