import { Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";
import { testFileSystemLayer } from "../../../../testing/layers/testFileSystemLayer";
import { testPlatformLayer } from "../../../../testing/layers/testPlatformLayer";
import { decodeProjectId, encodeProjectId } from "../../project/functions/id";
import type { SessionMeta } from "../../types";
import { SessionMetaService } from "../services/SessionMetaService";
import { createMockSessionMeta } from "../testing/createMockSessionMeta";
import {
  type SessionIndexRecord,
  SessionIndexService,
} from "./SessionIndexService";
import { SessionRepository } from "./SessionRepository";

const makeMeta = (): SessionMeta =>
  createMockSessionMeta({
    messageCount: 2,
    firstUserMessage: { kind: "text", content: "hello" },
    tokenUsage: {
      inputTokens: 10,
      cachedInputTokens: 0,
      outputTokens: 5,
      reasoningOutputTokens: 0,
      totalTokens: 15,
    },
    modelName: "gpt-5-codex",
  });

const makeRecord = (
  overrides: Partial<SessionIndexRecord> & {
    threadId: string;
    cwd: string;
    jsonlFilePath: string;
    lastModifiedAt: Date;
  },
): SessionIndexRecord => ({
  threadId: overrides.threadId,
  cwd: overrides.cwd,
  jsonlFilePath: overrides.jsonlFilePath,
  lastModifiedAt: overrides.lastModifiedAt,
  firstUserText: overrides.firstUserText ?? "hello",
  modelName: overrides.modelName ?? "gpt-5-codex",
  tokenUsage: overrides.tokenUsage ?? {
    inputTokens: 10,
    cachedInputTokens: 0,
    outputTokens: 5,
    reasoningOutputTokens: 0,
    totalTokens: 15,
  },
  lineCount: overrides.lineCount ?? 2,
  parsedLines: overrides.parsedLines ?? [],
});

const makeSessionIndexLayer = (records: SessionIndexRecord[]) =>
  Layer.succeed(
    SessionIndexService,
    SessionIndexService.of({
      getSessionIndices: () => Effect.succeed(records),
      getSessionIndicesWithParsedLines: () => Effect.succeed(records),
      getSessionByThreadId: (threadId: string) =>
        Effect.succeed(
          records.find((record) => record.threadId === threadId) ?? null,
        ),
      getSessionByThreadIdWithParsedLines: (threadId: string) =>
        Effect.succeed(
          records.find((record) => record.threadId === threadId) ?? null,
        ),
      warmSessionIndexCache: () => Effect.void,
    }),
  );

const makeSessionMetaLayer = (meta: SessionMeta) =>
  Layer.succeed(
    SessionMetaService,
    SessionMetaService.of({
      getSessionMeta: () => Effect.succeed(meta),
      invalidateSession: () => Effect.void,
    }),
  );

describe("SessionRepository", () => {
  describe("getSession", () => {
    it("returns session details for matching thread id and project", async () => {
      const projectPath = "/test/project";
      const projectId = encodeProjectId(projectPath);
      const sessionId = "thread-1";
      const jsonlFilePath = "/mock/sessions/thread-1/rollout-1.jsonl";
      const lastModifiedAt = new Date("2026-01-01T00:00:00.000Z");

      const records = [
        makeRecord({
          threadId: sessionId,
          cwd: projectPath,
          jsonlFilePath,
          lastModifiedAt,
        }),
      ];

      const jsonlContent = [
        JSON.stringify({
          timestamp: "2026-01-01T00:00:00.000Z",
          type: "session_meta",
          payload: {
            id: sessionId,
            timestamp: "2026-01-01T00:00:00.000Z",
            cwd: projectPath,
          },
        }),
        JSON.stringify({
          timestamp: "2026-01-01T00:00:01.000Z",
          type: "response_item",
          payload: {
            type: "message",
            role: "user",
            content: [{ type: "input_text", text: "hello" }],
          },
        }),
      ].join("\n");

      const program = Effect.gen(function* () {
        const repository = yield* SessionRepository;
        return yield* repository.getSession(projectId, sessionId);
      });

      const result = await Effect.runPromise(
        program.pipe(
          Effect.provide(SessionRepository.Live),
          Effect.provide(makeSessionMetaLayer(makeMeta())),
          Effect.provide(makeSessionIndexLayer(records)),
          Effect.provide(
            testFileSystemLayer({
              readFileString: () => Effect.succeed(jsonlContent),
            }),
          ),
          Effect.provide(testPlatformLayer()),
        ),
      );

      expect(result.session).not.toBeNull();
      if (result.session !== null) {
        expect(result.session.id).toBe(sessionId);
        expect(result.session.jsonlFilePath).toBe(jsonlFilePath);
        expect(result.session.lastModifiedAt).toEqual(lastModifiedAt);
        expect(result.session.conversations).toHaveLength(2);
      }
    });

    it("returns null when thread id is not in the target project", async () => {
      const projectId = encodeProjectId("/test/project-a");
      const sessionId = "thread-1";
      const records = [
        makeRecord({
          threadId: sessionId,
          cwd: "/test/project-b",
          jsonlFilePath: "/mock/sessions/thread-1/rollout-1.jsonl",
          lastModifiedAt: new Date(),
        }),
      ];

      const program = Effect.gen(function* () {
        const repository = yield* SessionRepository;
        return yield* repository.getSession(projectId, sessionId);
      });

      const result = await Effect.runPromise(
        program.pipe(
          Effect.provide(SessionRepository.Live),
          Effect.provide(makeSessionMetaLayer(makeMeta())),
          Effect.provide(makeSessionIndexLayer(records)),
          Effect.provide(testFileSystemLayer()),
          Effect.provide(testPlatformLayer()),
        ),
      );

      expect(result.session).toBeNull();
    });
  });

  describe("getSessions", () => {
    it("returns sessions for a project sorted by most recent update", async () => {
      const projectPath = "/test/project";
      const projectId = encodeProjectId(projectPath);

      const older = makeRecord({
        threadId: "thread-1",
        cwd: projectPath,
        jsonlFilePath: "/mock/sessions/thread-1/rollout-1.jsonl",
        lastModifiedAt: new Date("2026-01-01T00:00:00.000Z"),
      });
      const newer = makeRecord({
        threadId: "thread-2",
        cwd: projectPath,
        jsonlFilePath: "/mock/sessions/thread-2/rollout-1.jsonl",
        lastModifiedAt: new Date("2026-01-02T00:00:00.000Z"),
      });
      const otherProject = makeRecord({
        threadId: "thread-3",
        cwd: "/other/project",
        jsonlFilePath: "/mock/sessions/thread-3/rollout-1.jsonl",
        lastModifiedAt: new Date("2026-01-03T00:00:00.000Z"),
      });

      const program = Effect.gen(function* () {
        const repository = yield* SessionRepository;
        return yield* repository.getSessions(projectId);
      });

      const result = await Effect.runPromise(
        program.pipe(
          Effect.provide(SessionRepository.Live),
          Effect.provide(makeSessionMetaLayer(makeMeta())),
          Effect.provide(makeSessionIndexLayer([older, newer, otherProject])),
          Effect.provide(testFileSystemLayer()),
          Effect.provide(testPlatformLayer()),
        ),
      );

      expect(result.sessions.map((session) => session.id)).toEqual([
        "thread-2",
        "thread-1",
      ]);
    });

    it("supports cursor and maxCount paging", async () => {
      const projectPath = "/test/project";
      const projectId = encodeProjectId(projectPath);
      const records = [
        makeRecord({
          threadId: "thread-3",
          cwd: projectPath,
          jsonlFilePath: "/mock/sessions/thread-3/rollout-1.jsonl",
          lastModifiedAt: new Date("2026-01-03T00:00:00.000Z"),
        }),
        makeRecord({
          threadId: "thread-2",
          cwd: projectPath,
          jsonlFilePath: "/mock/sessions/thread-2/rollout-1.jsonl",
          lastModifiedAt: new Date("2026-01-02T00:00:00.000Z"),
        }),
        makeRecord({
          threadId: "thread-1",
          cwd: projectPath,
          jsonlFilePath: "/mock/sessions/thread-1/rollout-1.jsonl",
          lastModifiedAt: new Date("2026-01-01T00:00:00.000Z"),
        }),
      ];

      const program = Effect.gen(function* () {
        const repository = yield* SessionRepository;
        return yield* repository.getSessions(projectId, {
          cursor: "thread-2",
          maxCount: 1,
        });
      });

      const result = await Effect.runPromise(
        program.pipe(
          Effect.provide(SessionRepository.Live),
          Effect.provide(makeSessionMetaLayer(makeMeta())),
          Effect.provide(makeSessionIndexLayer(records)),
          Effect.provide(testFileSystemLayer()),
          Effect.provide(testPlatformLayer()),
        ),
      );

      expect(result.sessions).toHaveLength(1);
      expect(result.sessions[0]?.id).toBe("thread-1");
      expect(decodeProjectId(projectId)).toBe(projectPath);
    });
  });
});
