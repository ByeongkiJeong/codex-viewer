import { Path } from "@effect/platform";
import { Context, Effect, Layer, Ref } from "effect";
import type { InferEffect } from "../../../lib/effect/types";
import { SessionIndexService } from "../../session/infrastructure/SessionIndexService";
import type { ProjectMeta } from "../../types";
import { decodeProjectId } from "../functions/id";

const LayerImpl = Effect.gen(function* () {
  const path = yield* Path.Path;
  const sessionIndexService = yield* SessionIndexService;
  const cacheRef = yield* Ref.make(new Map<string, ProjectMeta>());

  const getProjectMeta = (projectId: string) =>
    Effect.gen(function* () {
      const cached = (yield* Ref.get(cacheRef)).get(projectId);
      if (cached !== undefined) {
        return cached;
      }

      const projectPath = decodeProjectId(projectId);
      const sessionIndices = yield* sessionIndexService.getSessionIndices();
      const projectSessions = sessionIndices.filter(
        (session) => session.cwd === projectPath,
      );

      const projectMeta: ProjectMeta = {
        projectName: path.basename(projectPath),
        projectPath,
        sessionCount: projectSessions.length,
      };

      yield* Ref.update(cacheRef, (map) => {
        const next = new Map(map);
        next.set(projectId, projectMeta);
        return next;
      });

      return projectMeta;
    });

  const invalidateProject = (projectId: string) =>
    Effect.gen(function* () {
      yield* Ref.update(cacheRef, (map) => {
        const next = new Map(map);
        next.delete(projectId);
        return next;
      });
    });

  return {
    getProjectMeta,
    invalidateProject,
  };
});

export type IProjectMetaService = InferEffect<typeof LayerImpl>;

export class ProjectMetaService extends Context.Tag("ProjectMetaService")<
  ProjectMetaService,
  IProjectMetaService
>() {
  static Live = Layer.effect(this, LayerImpl);
}
