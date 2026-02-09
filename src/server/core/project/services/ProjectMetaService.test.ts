import { Path } from "@effect/platform";
import { Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";
import {
  type SessionIndexRecord,
  SessionIndexService,
} from "../../session/infrastructure/SessionIndexService";
import { encodeProjectId } from "../functions/id";
import { ProjectMetaService } from "./ProjectMetaService";

const makeRecord = (overrides: {
  threadId: string;
  cwd: string;
  jsonlFilePath: string;
  lastModifiedAt: Date;
}): SessionIndexRecord => ({
  ...overrides,
  firstUserText: "hello",
  modelName: "gpt-5-codex",
  tokenUsage: {
    inputTokens: 10,
    cachedInputTokens: 0,
    outputTokens: 5,
    reasoningOutputTokens: 0,
    totalTokens: 15,
  },
  lineCount: 2,
  parsedLines: [],
});

const makeSessionIndexLayer = (
  records: SessionIndexRecord[],
  onRead?: () => void,
) =>
  Layer.succeed(
    SessionIndexService,
    SessionIndexService.of({
      getSessionIndices: () => {
        onRead?.();
        return Effect.succeed(records);
      },
      getSessionByThreadId: (threadId: string) =>
        Effect.succeed(
          records.find((record) => record.threadId === threadId) ?? null,
        ),
    }),
  );

describe("ProjectMetaService", () => {
  it("builds metadata from session index and caches results", async () => {
    const projectPath = "/test/project";
    const projectId = encodeProjectId(projectPath);
    let readCount = 0;

    const records = [
      makeRecord({
        threadId: "thread-1",
        cwd: projectPath,
        jsonlFilePath: "/mock/sessions/thread-1/rollout-1.jsonl",
        lastModifiedAt: new Date("2026-01-01T00:00:00.000Z"),
      }),
      makeRecord({
        threadId: "thread-2",
        cwd: projectPath,
        jsonlFilePath: "/mock/sessions/thread-2/rollout-1.jsonl",
        lastModifiedAt: new Date("2026-01-02T00:00:00.000Z"),
      }),
    ];

    const program = Effect.gen(function* () {
      const service = yield* ProjectMetaService;
      const first = yield* service.getProjectMeta(projectId);
      const second = yield* service.getProjectMeta(projectId);
      return { first, second };
    });

    const result = await Effect.runPromise(
      program.pipe(
        Effect.provide(ProjectMetaService.Live),
        Effect.provide(
          makeSessionIndexLayer(records, () => {
            readCount += 1;
          }),
        ),
        Effect.provide(Path.layer),
      ),
    );

    expect(result.first).toEqual({
      projectName: "project",
      projectPath,
      sessionCount: 2,
    });
    expect(result.second).toEqual(result.first);
    expect(readCount).toBe(1);
  });

  it("invalidates cached metadata", async () => {
    const projectPath = "/test/project";
    const projectId = encodeProjectId(projectPath);
    let readCount = 0;

    const records = [
      makeRecord({
        threadId: "thread-1",
        cwd: projectPath,
        jsonlFilePath: "/mock/sessions/thread-1/rollout-1.jsonl",
        lastModifiedAt: new Date("2026-01-01T00:00:00.000Z"),
      }),
    ];

    const program = Effect.gen(function* () {
      const service = yield* ProjectMetaService;
      yield* service.getProjectMeta(projectId);
      yield* service.invalidateProject(projectId);
      yield* service.getProjectMeta(projectId);
    });

    await Effect.runPromise(
      program.pipe(
        Effect.provide(ProjectMetaService.Live),
        Effect.provide(
          makeSessionIndexLayer(records, () => {
            readCount += 1;
          }),
        ),
        Effect.provide(Path.layer),
      ),
    );

    expect(readCount).toBe(2);
  });
});
