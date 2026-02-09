import { Context, Effect, Layer, Ref } from "effect";
import type { SessionMeta } from "../../types";
import { parseUserMessage } from "../functions/parseUserMessage";
import { SessionIndexService } from "../infrastructure/SessionIndexService";

export class SessionMetaService extends Context.Tag("SessionMetaService")<
  SessionMetaService,
  {
    readonly getSessionMeta: (
      projectId: string,
      sessionId: string,
    ) => Effect.Effect<SessionMeta, Error>;
    readonly invalidateSession: (
      projectId: string,
      sessionId: string,
    ) => Effect.Effect<void>;
  }
>() {
  static Live = Layer.effect(
    this,
    Effect.gen(function* () {
      const sessionIndexService = yield* SessionIndexService;
      const cacheRef = yield* Ref.make(new Map<string, SessionMeta>());

      const getSessionMeta = (
        _projectId: string,
        sessionId: string,
      ): Effect.Effect<SessionMeta, Error> =>
        Effect.gen(function* () {
          const cached = (yield* Ref.get(cacheRef)).get(sessionId);
          if (cached !== undefined) {
            return cached;
          }

          const session =
            yield* sessionIndexService.getSessionByThreadId(sessionId);
          if (session === null) {
            return yield* Effect.fail(new Error("Session not found"));
          }

          const firstUserMessage =
            session.firstUserText !== null
              ? parseUserMessage(session.firstUserText)
              : null;

          const meta: SessionMeta = {
            messageCount: session.lineCount,
            firstUserMessage,
            tokenUsage: session.tokenUsage,
            modelName: session.modelName,
          };

          yield* Ref.update(cacheRef, (map) => {
            const next = new Map(map);
            next.set(sessionId, meta);
            return next;
          });

          return meta;
        });

      const invalidateSession = (
        _projectId: string,
        sessionId: string,
      ): Effect.Effect<void> =>
        Effect.gen(function* () {
          yield* Ref.update(cacheRef, (map) => {
            const next = new Map(map);
            next.delete(sessionId);
            return next;
          });
        });

      return {
        getSessionMeta,
        invalidateSession,
      };
    }),
  );
}

export type ISessionMetaService = Context.Tag.Service<
  typeof SessionMetaService
>;
