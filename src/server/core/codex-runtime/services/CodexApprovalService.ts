import { Context, Data, Effect, Layer, Ref } from "effect";
import { ulid } from "ulid";
import type {
  PermissionRequest,
  PermissionRequestKind,
  PermissionResponse,
} from "../../../../types/permissions";
import type { InferEffect } from "../../../lib/effect/types";
import { EventBus } from "../../events/services/EventBus";
import { CodexRpcClientService } from "./CodexRpcClientService";
import { CodexSessionProcessService } from "./CodexSessionProcessService";

type PendingApproval = {
  request: PermissionRequest;
  rpcRequestId: string | number;
  method:
    | "item/commandExecution/requestApproval"
    | "item/fileChange/requestApproval"
    | "applyPatchApproval"
    | "execCommandApproval";
};

let sharedPendingRef: Ref.Ref<Map<string, PendingApproval>> | null = null;

const getSharedPendingRef = (): Effect.Effect<
  Ref.Ref<Map<string, PendingApproval>>
> =>
  Effect.gen(function* () {
    if (sharedPendingRef !== null) {
      return sharedPendingRef;
    }

    const created = yield* Ref.make(new Map<string, PendingApproval>());
    sharedPendingRef = created;
    return created;
  });

class PermissionRequestNotFoundError extends Data.TaggedError(
  "PermissionRequestNotFoundError",
)<{
  permissionRequestId: string;
}> {}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const getStringField = (value: unknown, key: string): string | null => {
  if (!isRecord(value)) {
    return null;
  }
  const field = value[key];
  return typeof field === "string" ? field : null;
};

const mapRequestMethod = (
  method: string,
): {
  kind: PermissionRequestKind;
  toolName: string;
  method: PendingApproval["method"];
} | null => {
  if (method === "item/commandExecution/requestApproval") {
    return {
      kind: "commandExecution",
      toolName: "commandExecution",
      method,
    };
  }

  if (method === "item/fileChange/requestApproval") {
    return {
      kind: "fileChange",
      toolName: "fileChange",
      method,
    };
  }

  if (method === "applyPatchApproval") {
    return {
      kind: "applyPatch",
      toolName: "applyPatch",
      method,
    };
  }

  if (method === "execCommandApproval") {
    return {
      kind: "execCommand",
      toolName: "execCommand",
      method,
    };
  }

  return null;
};

const mapDecision = (
  method: PendingApproval["method"],
  decision: PermissionResponse["decision"],
): string => {
  if (
    method === "item/commandExecution/requestApproval" ||
    method === "item/fileChange/requestApproval"
  ) {
    return decision === "allow" ? "accept" : "cancel";
  }

  return decision === "allow" ? "approved" : "abort";
};

const LayerImpl = Effect.gen(function* () {
  const rpc = yield* CodexRpcClientService;
  const eventBus = yield* EventBus;
  const processService = yield* CodexSessionProcessService;
  const pendingRef = yield* getSharedPendingRef();

  const handleRpcRequest = (request: {
    id: string | number;
    method: string;
    params?: unknown;
  }) =>
    Effect.gen(function* () {
      const mapped = mapRequestMethod(request.method);
      if (mapped === null) {
        return;
      }

      const sessionId =
        getStringField(request.params, "threadId") ??
        getStringField(request.params, "conversationId");
      if (sessionId === null) {
        return;
      }

      const turnId = getStringField(request.params, "turnId") ?? undefined;
      const requestId = ulid();
      const toolInput = isRecord(request.params) ? request.params : {};

      const permissionRequest: PermissionRequest = {
        id: requestId,
        kind: mapped.kind,
        turnId,
        sessionId,
        toolName: mapped.toolName,
        toolInput,
        timestamp: Date.now(),
      };

      const pending: PendingApproval = {
        request: permissionRequest,
        rpcRequestId: request.id,
        method: mapped.method,
      };

      yield* Ref.update(pendingRef, (current) => {
        const next = new Map(current);
        next.set(permissionRequest.id, pending);
        return next;
      });

      yield* processService
        .setAwaitingApproval(sessionId)
        .pipe(Effect.catchAll(() => Effect.succeed(null)));

      yield* eventBus.emit("permissionRequested", {
        permissionRequest,
      });
    });

  const permissionResponse = (options: {
    permissionResponse: PermissionResponse;
  }) =>
    Effect.gen(function* () {
      const { permissionResponse } = options;
      const pendingMap = yield* Ref.get(pendingRef);
      const pending = pendingMap.get(permissionResponse.permissionRequestId);

      if (pending === undefined) {
        return yield* Effect.fail(
          new PermissionRequestNotFoundError({
            permissionRequestId: permissionResponse.permissionRequestId,
          }),
        );
      }

      const result = {
        decision: mapDecision(pending.method, permissionResponse.decision),
      };

      yield* rpc.respond(pending.rpcRequestId, result);

      yield* Ref.update(pendingRef, (current) => {
        const next = new Map(current);
        next.delete(permissionResponse.permissionRequestId);
        return next;
      });

      yield* processService
        .resumeAfterApproval(pending.request.sessionId)
        .pipe(Effect.catchAll(() => Effect.succeed(null)));

      return {
        permissionRequestId: permissionResponse.permissionRequestId,
      };
    });

  return {
    handleRpcRequest,
    permissionResponse,
  };
});

export type ICodexApprovalService = InferEffect<typeof LayerImpl>;
export class CodexApprovalService extends Context.Tag("CodexApprovalService")<
  CodexApprovalService,
  ICodexApprovalService
>() {
  static Live = Layer.effect(this, LayerImpl);
}
