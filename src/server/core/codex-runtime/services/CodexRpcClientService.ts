import { Context, Data, Effect, Layer, Ref } from "effect";
import { CodexAppServerService } from "./CodexAppServerService";

type JsonRpcId = string | number;

type JsonRpcRequest = {
  jsonrpc: "2.0";
  id: JsonRpcId;
  method: string;
  params?: unknown;
};

type JsonRpcNotification = {
  jsonrpc: "2.0";
  method: string;
  params?: unknown;
};

type JsonRpcSuccessResponse = {
  id: JsonRpcId;
  result: unknown;
};

type JsonRpcErrorResponse = {
  id: JsonRpcId;
  error: {
    code: number;
    message: string;
    data?: unknown;
  };
};

type JsonRpcResponse = JsonRpcSuccessResponse | JsonRpcErrorResponse;

type JsonRpcServerRequest = {
  id: JsonRpcId;
  method: string;
  params?: unknown;
};

type JsonRpcServerNotification = {
  method: string;
  params?: unknown;
};

class JsonRpcError extends Data.TaggedError("JsonRpcError")<{
  code: number;
  message: string;
  data?: unknown;
}> {}

class RpcProtocolError extends Data.TaggedError("RpcProtocolError")<{
  message: string;
}> {}

const isAlreadyInitializedError = (error: unknown): boolean =>
  error instanceof JsonRpcError && error.message === "Already initialized";

const responseKey = (id: JsonRpcId) => `${typeof id}:${String(id)}`;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isJsonRpcResponse = (value: unknown): value is JsonRpcResponse => {
  if (!isRecord(value) || !("id" in value)) {
    return false;
  }

  if ("result" in value) {
    return true;
  }

  if (!("error" in value)) {
    return false;
  }

  const error = value.error;
  return (
    isRecord(error) &&
    typeof error.code === "number" &&
    typeof error.message === "string"
  );
};

const isJsonRpcServerRequest = (
  value: unknown,
): value is JsonRpcServerRequest =>
  isRecord(value) &&
  "id" in value &&
  (typeof value.id === "string" || typeof value.id === "number") &&
  typeof value.method === "string" &&
  (!("jsonrpc" in value) || value.jsonrpc === "2.0");

const isJsonRpcServerNotification = (
  value: unknown,
): value is JsonRpcServerNotification =>
  isRecord(value) &&
  (!("id" in value) || value.id === null) &&
  typeof value.method === "string" &&
  (!("jsonrpc" in value) || value.jsonrpc === "2.0");

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
};

type RpcState = {
  initialized: boolean;
  listenerAttached: boolean;
};

interface CodexRpcClientServiceInterface {
  readonly ensureInitialized: () => Effect.Effect<void, unknown>;
  readonly sendRequest: (
    method: string,
    params?: unknown,
  ) => Effect.Effect<unknown, unknown>;
  readonly sendNotification: (
    method: string,
    params?: unknown,
  ) => Effect.Effect<void, unknown>;
  readonly respond: (
    id: JsonRpcId,
    result: unknown,
  ) => Effect.Effect<void, unknown>;
  readonly onNotification: (
    listener: (notification: JsonRpcServerNotification) => void,
  ) => Effect.Effect<() => void>;
  readonly onServerRequest: (
    listener: (request: JsonRpcServerRequest) => void,
  ) => Effect.Effect<() => void>;
}

const LayerImpl = Effect.gen(function* () {
  const appServer = yield* CodexAppServerService;
  const stateRef = yield* Ref.make<RpcState>({
    initialized: false,
    listenerAttached: false,
  });

  const notificationListeners = new Set<
    (notification: JsonRpcServerNotification) => void
  >();
  const requestListeners = new Set<(request: JsonRpcServerRequest) => void>();
  const pending = new Map<string, PendingRequest>();
  let nextRequestId = 1;

  const handleIncoming = (line: string) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      return;
    }

    if (isJsonRpcResponse(parsed)) {
      const key = responseKey(parsed.id);
      const pendingRequest = pending.get(key);
      if (pendingRequest === undefined) {
        return;
      }
      pending.delete(key);

      if ("error" in parsed) {
        pendingRequest.reject(
          new JsonRpcError({
            code: parsed.error.code,
            message: parsed.error.message,
            data: parsed.error.data,
          }),
        );
        return;
      }

      pendingRequest.resolve(parsed.result);
      return;
    }

    if (isJsonRpcServerRequest(parsed)) {
      for (const listener of requestListeners) {
        listener({
          id: parsed.id,
          method: parsed.method,
          params: parsed.params,
        });
      }
      return;
    }

    if (isJsonRpcServerNotification(parsed)) {
      for (const listener of notificationListeners) {
        listener({
          method: parsed.method,
          params: parsed.params,
        });
      }
    }
  };

  const attachLineListener = (): Effect.Effect<void, unknown> =>
    Effect.gen(function* () {
      const state = yield* Ref.get(stateRef);
      if (state.listenerAttached) {
        return;
      }

      yield* appServer.addLineListener(handleIncoming);
      yield* Ref.update(stateRef, (prev) => ({
        ...prev,
        listenerAttached: true,
      }));
    });

  const rawSendRequest = (
    method: string,
    params?: unknown,
  ): Effect.Effect<unknown, unknown> =>
    Effect.tryPromise({
      try: async () => {
        const id = nextRequestId;
        nextRequestId += 1;
        const key = responseKey(id);

        const payload: JsonRpcRequest = {
          jsonrpc: "2.0",
          id,
          method,
          ...(params === undefined ? {} : { params }),
        };

        return await new Promise<unknown>((resolve, reject) => {
          pending.set(key, {
            resolve: (value) => resolve(value),
            reject,
          });

          Effect.runPromise(
            appServer.writeMessage(JSON.stringify(payload)),
          ).catch((error: unknown) => {
            pending.delete(key);
            reject(error instanceof Error ? error : new Error(String(error)));
          });
        });
      },
      catch: (error: unknown) =>
        error instanceof Error
          ? error
          : new RpcProtocolError({
              message: `Failed to send RPC request ${method}: ${String(error)}`,
            }),
    });

  const sendNotification = (
    method: string,
    params?: unknown,
  ): Effect.Effect<void, unknown> =>
    Effect.gen(function* () {
      const payload: JsonRpcNotification = {
        jsonrpc: "2.0",
        method,
        ...(params === undefined ? {} : { params }),
      };
      yield* appServer.writeMessage(JSON.stringify(payload));
    });

  const ensureInitialized = (): Effect.Effect<void, unknown> =>
    Effect.gen(function* () {
      const state = yield* Ref.get(stateRef);
      if (state.initialized) {
        return;
      }

      yield* appServer.ensureStarted();
      yield* attachLineListener();

      yield* rawSendRequest("initialize", {
        clientInfo: {
          name: "codex-viewer",
          version: "0.0.0",
        },
      }).pipe(Effect.catchIf(isAlreadyInitializedError, () => Effect.void));

      yield* sendNotification("initialized");

      yield* Ref.update(stateRef, (prev) => ({
        ...prev,
        initialized: true,
      }));
    });

  const sendRequest = (
    method: string,
    params?: unknown,
  ): Effect.Effect<unknown, unknown> =>
    Effect.gen(function* () {
      yield* ensureInitialized();
      return yield* rawSendRequest(method, params);
    });

  const respond = (
    id: JsonRpcId,
    result: unknown,
  ): Effect.Effect<void, unknown> =>
    Effect.gen(function* () {
      yield* ensureInitialized();
      yield* appServer.writeMessage(
        JSON.stringify({
          jsonrpc: "2.0",
          id,
          result,
        }),
      );
    });

  const onNotification = (
    listener: (notification: JsonRpcServerNotification) => void,
  ): Effect.Effect<() => void> =>
    Effect.gen(function* () {
      notificationListeners.add(listener);
      return () => {
        notificationListeners.delete(listener);
      };
    });

  const onServerRequest = (
    listener: (request: JsonRpcServerRequest) => void,
  ): Effect.Effect<() => void> =>
    Effect.gen(function* () {
      requestListeners.add(listener);
      return () => {
        requestListeners.delete(listener);
      };
    });

  return {
    ensureInitialized,
    sendRequest,
    sendNotification,
    respond,
    onNotification,
    onServerRequest,
  } satisfies CodexRpcClientServiceInterface;
});

export type ICodexRpcClientService = CodexRpcClientServiceInterface;
export class CodexRpcClientService extends Context.Tag("CodexRpcClientService")<
  CodexRpcClientService,
  ICodexRpcClientService
>() {
  static Live = Layer.effect(this, LayerImpl);
}
