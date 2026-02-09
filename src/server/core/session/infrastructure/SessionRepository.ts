import { FileSystem } from "@effect/platform";
import { Context, Effect, Layer } from "effect";
import { parseCodexJsonl } from "../../../../lib/codex-conversation-schema/parseCodexJsonl";
import type { InferEffect } from "../../../lib/effect/types";
import { decodeProjectId } from "../../project/functions/id";
import type { Session, SessionDetail } from "../../types";
import { SessionMetaService } from "../services/SessionMetaService";
import { SessionIndexService } from "./SessionIndexService";

const LayerImpl = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const sessionMetaService = yield* SessionMetaService;
  const sessionIndexService = yield* SessionIndexService;

  const getSession = (projectId: string, sessionId: string) =>
    Effect.gen(function* () {
      const projectPath = decodeProjectId(projectId);
      const record = yield* sessionIndexService.getSessionByThreadId(sessionId);

      if (record === null || record.cwd !== projectPath) {
        return {
          session: null,
        };
      }

      const content = yield* fs.readFileString(record.jsonlFilePath);
      const conversations = parseCodexJsonl(content);
      const meta = yield* sessionMetaService.getSessionMeta(
        projectId,
        sessionId,
      );

      const session: SessionDetail = {
        id: sessionId,
        jsonlFilePath: record.jsonlFilePath,
        lastModifiedAt: record.lastModifiedAt,
        meta,
        conversations,
      };

      return {
        session,
      };
    });

  const getSessions = (
    projectId: string,
    options?: {
      maxCount?: number;
      cursor?: string;
    },
  ) =>
    Effect.gen(function* () {
      const { maxCount = 20, cursor } = options ?? {};
      const projectPath = decodeProjectId(projectId);
      const allSessions = (yield* sessionIndexService.getSessionIndices())
        .filter((record) => record.cwd === projectPath)
        .toSorted(
          (a, b) => b.lastModifiedAt.getTime() - a.lastModifiedAt.getTime(),
        );

      const startIndex =
        cursor === undefined
          ? 0
          : (() => {
              const index = allSessions.findIndex(
                (session) => session.threadId === cursor,
              );
              if (index === -1) {
                return 0;
              }
              return index + 1;
            })();

      const sessionsSlice = allSessions.slice(
        startIndex,
        startIndex + maxCount,
      );

      const sessions: Session[] = yield* Effect.all(
        sessionsSlice.map((record) =>
          Effect.gen(function* () {
            const meta = yield* sessionMetaService.getSessionMeta(
              projectId,
              record.threadId,
            );
            return {
              id: record.threadId,
              jsonlFilePath: record.jsonlFilePath,
              lastModifiedAt: record.lastModifiedAt,
              meta,
            } satisfies Session;
          }),
        ),
        { concurrency: "unbounded" },
      );

      return {
        sessions,
      };
    });

  return {
    getSession,
    getSessions,
  };
});

export type ISessionRepository = InferEffect<typeof LayerImpl>;

export class SessionRepository extends Context.Tag("SessionRepository")<
  SessionRepository,
  ISessionRepository
>() {
  static Live = Layer.effect(this, LayerImpl);
}
