import { Context, Data, Effect, Layer } from "effect";
import type { InferEffect } from "../../../lib/effect/types";
import { SessionIndexService } from "../../session/infrastructure/SessionIndexService";
import type { Project } from "../../types";
import { decodeProjectId, encodeProjectId } from "../functions/id";
import { ProjectMetaService } from "../services/ProjectMetaService";

class ProjectNotFoundError extends Data.TaggedError("ProjectNotFoundError")<{
  projectId: string;
}> {}

const LayerImpl = Effect.gen(function* () {
  const sessionIndexService = yield* SessionIndexService;
  const projectMetaService = yield* ProjectMetaService;

  const getProject = (projectId: string) =>
    Effect.gen(function* () {
      const projectPath = decodeProjectId(projectId);
      const records = yield* sessionIndexService.getSessionIndices();
      const projectRecords = records.filter(
        (record) => record.cwd === projectPath,
      );

      if (projectRecords.length === 0) {
        return yield* Effect.fail(new ProjectNotFoundError({ projectId }));
      }

      const meta = yield* projectMetaService.getProjectMeta(projectId);
      const lastModifiedAt = projectRecords.reduce(
        (latest, record) =>
          record.lastModifiedAt.getTime() > latest.getTime()
            ? record.lastModifiedAt
            : latest,
        projectRecords[0]?.lastModifiedAt ?? new Date(),
      );

      return {
        project: {
          id: projectId,
          projectPath: projectPath,
          lastModifiedAt,
          meta,
        } satisfies Project,
      };
    });

  const getProjects = () =>
    Effect.gen(function* () {
      const records = yield* sessionIndexService.getSessionIndices();

      const grouped = records.reduce((map, record) => {
        const list = map.get(record.cwd) ?? [];
        list.push(record);
        map.set(record.cwd, list);
        return map;
      }, new Map<string, typeof records>());

      const projects = yield* Effect.all(
        Array.from(grouped.entries()).map(([cwd, group]) =>
          Effect.gen(function* () {
            const id = encodeProjectId(cwd);
            const meta = yield* projectMetaService.getProjectMeta(id);
            const lastModifiedAt = group.reduce(
              (latest, record) =>
                record.lastModifiedAt.getTime() > latest.getTime()
                  ? record.lastModifiedAt
                  : latest,
              group[0]?.lastModifiedAt ?? new Date(),
            );

            return {
              id,
              projectPath: cwd,
              lastModifiedAt,
              meta,
            } satisfies Project;
          }),
        ),
        { concurrency: "unbounded" },
      );

      return {
        projects: projects.toSorted(
          (a, b) => b.lastModifiedAt.getTime() - a.lastModifiedAt.getTime(),
        ),
      };
    });

  return {
    getProject,
    getProjects,
  };
});

export type IProjectRepository = InferEffect<typeof LayerImpl>;
export class ProjectRepository extends Context.Tag("ProjectRepository")<
  ProjectRepository,
  IProjectRepository
>() {
  static Live = Layer.effect(this, LayerImpl);
}
