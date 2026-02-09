import { Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";
import {
  type SessionIndexRecord,
  SessionIndexService,
} from "../../session/infrastructure/SessionIndexService";
import { decodeProjectId, encodeProjectId } from "../functions/id";
import { ProjectMetaService } from "../services/ProjectMetaService";
import { ProjectRepository } from "./ProjectRepository";

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

const makeSessionIndexLayer = (records: SessionIndexRecord[]) =>
  Layer.succeed(
    SessionIndexService,
    SessionIndexService.of({
      getSessionIndices: () => Effect.succeed(records),
      getSessionByThreadId: (threadId: string) =>
        Effect.succeed(
          records.find((record) => record.threadId === threadId) ?? null,
        ),
    }),
  );

const makeProjectMetaLayer = () =>
  Layer.succeed(
    ProjectMetaService,
    ProjectMetaService.of({
      getProjectMeta: (projectId: string) =>
        Effect.succeed({
          projectName: decodeProjectId(projectId).split("/").at(-1) ?? null,
          projectPath: decodeProjectId(projectId),
          sessionCount: 2,
        }),
      invalidateProject: () => Effect.void,
    }),
  );

describe("ProjectRepository", () => {
  it("returns a project when sessions exist for the cwd", async () => {
    const projectPath = "/test/project-a";
    const projectId = encodeProjectId(projectPath);

    const records = [
      makeRecord({
        threadId: "thread-1",
        cwd: projectPath,
        jsonlFilePath: "/mock/sessions/a/rollout-1.jsonl",
        lastModifiedAt: new Date("2026-01-01T00:00:00.000Z"),
      }),
      makeRecord({
        threadId: "thread-2",
        cwd: projectPath,
        jsonlFilePath: "/mock/sessions/a/rollout-2.jsonl",
        lastModifiedAt: new Date("2026-01-03T00:00:00.000Z"),
      }),
    ];

    const program = Effect.gen(function* () {
      const repository = yield* ProjectRepository;
      return yield* repository.getProject(projectId);
    });

    const result = await Effect.runPromise(
      program.pipe(
        Effect.provide(ProjectRepository.Live),
        Effect.provide(makeProjectMetaLayer()),
        Effect.provide(makeSessionIndexLayer(records)),
      ),
    );

    expect(result.project.id).toBe(projectId);
    expect(result.project.projectPath).toBe(projectPath);
    expect(result.project.lastModifiedAt).toEqual(
      new Date("2026-01-03T00:00:00.000Z"),
    );
  });

  it("fails when no sessions exist for project", async () => {
    const projectId = encodeProjectId("/missing/project");

    const program = Effect.gen(function* () {
      const repository = yield* ProjectRepository;
      return yield* repository.getProject(projectId);
    });

    await expect(
      Effect.runPromise(
        program.pipe(
          Effect.provide(ProjectRepository.Live),
          Effect.provide(makeProjectMetaLayer()),
          Effect.provide(makeSessionIndexLayer([])),
        ),
      ),
    ).rejects.toThrow("An error has occurred");
  });

  it("groups projects by cwd and sorts by latest update", async () => {
    const projectA = "/test/project-a";
    const projectB = "/test/project-b";

    const records = [
      makeRecord({
        threadId: "thread-a1",
        cwd: projectA,
        jsonlFilePath: "/mock/sessions/a/rollout-1.jsonl",
        lastModifiedAt: new Date("2026-01-01T00:00:00.000Z"),
      }),
      makeRecord({
        threadId: "thread-a2",
        cwd: projectA,
        jsonlFilePath: "/mock/sessions/a/rollout-2.jsonl",
        lastModifiedAt: new Date("2026-01-02T00:00:00.000Z"),
      }),
      makeRecord({
        threadId: "thread-b1",
        cwd: projectB,
        jsonlFilePath: "/mock/sessions/b/rollout-1.jsonl",
        lastModifiedAt: new Date("2026-01-03T00:00:00.000Z"),
      }),
    ];

    const program = Effect.gen(function* () {
      const repository = yield* ProjectRepository;
      return yield* repository.getProjects();
    });

    const result = await Effect.runPromise(
      program.pipe(
        Effect.provide(ProjectRepository.Live),
        Effect.provide(makeProjectMetaLayer()),
        Effect.provide(makeSessionIndexLayer(records)),
      ),
    );

    expect(result.projects).toHaveLength(2);
    expect(result.projects[0]?.projectPath).toBe(projectB);
    expect(result.projects[1]?.projectPath).toBe(projectA);
  });
});
