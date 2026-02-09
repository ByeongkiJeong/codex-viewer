import { Effect, Layer, Ref } from "effect";
import { describe, expect, it } from "vitest";
import {
  CodexAppServerService,
  type ICodexAppServerService,
} from "./CodexAppServerService";
import { CodexRpcClientService } from "./CodexRpcClientService";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

describe("CodexRpcClientService", () => {
  it("allows repeated initialize when app-server is already initialized", async () => {
    const listeners = new Set<(line: string) => void>();

    const emitLine = (payload: unknown) => {
      const line = JSON.stringify(payload);
      for (const listener of listeners) {
        listener(line);
      }
    };

    const mockAppServer: ICodexAppServerService = {
      ensureStarted: () => Effect.void,
      writeMessage: (message: string) =>
        Effect.sync(() => {
          const parsed: unknown = JSON.parse(message);
          if (!isRecord(parsed)) {
            return;
          }

          if (
            parsed.jsonrpc === "2.0" &&
            typeof parsed.id === "number" &&
            parsed.method === "initialize"
          ) {
            emitLine({
              jsonrpc: "2.0",
              id: parsed.id,
              error: {
                code: -32000,
                message: "Already initialized",
              },
            });
          }
        }),
      addLineListener: (listener: (line: string) => void) =>
        Effect.sync(() => {
          listeners.add(listener);
          return () => {
            listeners.delete(listener);
          };
        }),
      getExecutablePath: () => Effect.succeed("codex"),
      getStartError: () => Effect.succeed(null),
    };

    const appServerLayer = Layer.succeed(CodexAppServerService, mockAppServer);

    await expect(
      Effect.runPromise(
        Effect.gen(function* () {
          const rpc = yield* CodexRpcClientService;
          yield* rpc.ensureInitialized();
        }).pipe(
          Effect.provide(CodexRpcClientService.Live),
          Effect.provide(appServerLayer),
        ),
      ),
    ).resolves.toBeUndefined();
  });

  it("treats json-rpc messages with id:null as notifications", async () => {
    const listeners = new Set<(line: string) => void>();

    const emitLine = (payload: unknown) => {
      const line = JSON.stringify(payload);
      for (const listener of listeners) {
        listener(line);
      }
    };

    const mockAppServer: ICodexAppServerService = {
      ensureStarted: () => Effect.void,
      writeMessage: (message: string) =>
        Effect.sync(() => {
          const parsed: unknown = JSON.parse(message);
          if (!isRecord(parsed)) {
            return;
          }

          if (
            parsed.jsonrpc === "2.0" &&
            typeof parsed.id === "number" &&
            parsed.method === "initialize"
          ) {
            emitLine({
              jsonrpc: "2.0",
              id: parsed.id,
              result: { ok: true },
            });
          }
        }),
      addLineListener: (listener: (line: string) => void) =>
        Effect.sync(() => {
          listeners.add(listener);
          return () => {
            listeners.delete(listener);
          };
        }),
      getExecutablePath: () => Effect.succeed("codex"),
      getStartError: () => Effect.succeed(null),
    };

    const appServerLayer = Layer.succeed(CodexAppServerService, mockAppServer);

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const rpc = yield* CodexRpcClientService;
        const notificationRef = yield* Ref.make<string | null>(null);
        const requestRef = yield* Ref.make<string | null>(null);

        yield* rpc.onNotification((notification) => {
          Effect.runFork(Ref.set(notificationRef, notification.method));
        });

        yield* rpc.onServerRequest((request) => {
          Effect.runFork(Ref.set(requestRef, request.method));
        });

        yield* rpc.ensureInitialized();

        emitLine({
          jsonrpc: "2.0",
          id: null,
          method: "turn/completed",
          params: {
            threadId: "thread-id",
            turn: {
              id: "turn-id",
              status: "completed",
            },
          },
        });

        yield* Effect.sleep("10 millis");

        const notificationMethod = yield* Ref.get(notificationRef);
        const requestMethod = yield* Ref.get(requestRef);

        return {
          notificationMethod,
          requestMethod,
        };
      }).pipe(
        Effect.provide(CodexRpcClientService.Live),
        Effect.provide(appServerLayer),
      ),
    );

    expect(result.notificationMethod).toBe("turn/completed");
    expect(result.requestMethod).toBeNull();
  });
});
