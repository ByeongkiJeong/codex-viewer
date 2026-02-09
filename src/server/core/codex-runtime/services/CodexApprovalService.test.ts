import { Effect, Layer, Ref } from "effect";
import { describe, expect, it } from "vitest";
import type { PermissionRequest } from "../../../../types/permissions";
import { EventBus } from "../../events/services/EventBus";
import { CodexApprovalService } from "./CodexApprovalService";
import {
  CodexRpcClientService,
  type ICodexRpcClientService,
} from "./CodexRpcClientService";
import {
  CodexSessionProcessService,
  type ICodexSessionProcessService,
} from "./CodexSessionProcessService";

type RpcResponseCall = {
  id: string | number;
  result: unknown;
};

type ProcessServiceSpies = {
  awaitingCalls: string[];
  resumedCalls: string[];
};

const createRpcLayer = (respondCalls: RpcResponseCall[]) => {
  const rpc: ICodexRpcClientService = {
    ensureInitialized: () => Effect.void,
    sendRequest: () => Effect.fail(new Error("sendRequest is not expected")),
    sendNotification: () =>
      Effect.fail(new Error("sendNotification is not expected")),
    respond: (id, result) =>
      Effect.sync(() => {
        respondCalls.push({ id, result });
      }),
    onNotification: () => Effect.succeed(() => undefined),
    onServerRequest: () => Effect.succeed(() => undefined),
  };

  return Layer.succeed(CodexRpcClientService, rpc);
};

const createSessionProcessLayer = (spies: ProcessServiceSpies) => {
  const service: ICodexSessionProcessService = {
    startSessionProcess: () =>
      Effect.die("startSessionProcess is not expected"),
    continueSessionProcess: () =>
      Effect.die("continueSessionProcess is not expected"),
    abortSessionProcess: () =>
      Effect.die("abortSessionProcess is not expected"),
    getSessionProcesses: () => Effect.succeed([]),
    getSessionProcess: () => Effect.die("getSessionProcess is not expected"),
    handleRpcNotification: () => Effect.void,
    setAwaitingApproval: (sessionId) =>
      Effect.sync(() => {
        spies.awaitingCalls.push(sessionId);
        return null;
      }),
    resumeAfterApproval: (sessionId) =>
      Effect.sync(() => {
        spies.resumedCalls.push(sessionId);
        return null;
      }),
  };

  return Layer.succeed(CodexSessionProcessService, service);
};

const runWithApprovalService = <A, E>(
  program: Effect.Effect<A, E, CodexApprovalService | EventBus>,
  options: {
    rpcLayer: Layer.Layer<CodexRpcClientService>;
    processLayer: Layer.Layer<CodexSessionProcessService>;
  },
) =>
  Effect.runPromise(
    program.pipe(
      Effect.provide(CodexApprovalService.Live),
      Effect.provide(EventBus.Live),
      Effect.provide(options.rpcLayer),
      Effect.provide(options.processLayer),
    ),
  );

describe("CodexApprovalService", () => {
  it("maps commandExecution approval allow to accept and resumes process", async () => {
    const respondCalls: RpcResponseCall[] = [];
    const spies: ProcessServiceSpies = {
      awaitingCalls: [],
      resumedCalls: [],
    };

    const rpcLayer = createRpcLayer(respondCalls);
    const processLayer = createSessionProcessLayer(spies);

    const result = await runWithApprovalService(
      Effect.gen(function* () {
        const eventBus = yield* EventBus;
        const approvalService = yield* CodexApprovalService;
        const permissionRequestRef = yield* Ref.make<PermissionRequest | null>(
          null,
        );

        yield* eventBus.on("permissionRequested", (event) => {
          Ref.set(permissionRequestRef, event.permissionRequest).pipe(
            Effect.runFork,
          );
        });

        yield* approvalService.handleRpcRequest({
          id: 101,
          method: "item/commandExecution/requestApproval",
          params: {
            threadId: "thread-command",
            turnId: "turn-1",
            command: "ls -la",
          },
        });

        yield* Effect.sleep("10 millis");

        const permissionRequest = yield* Ref.get(permissionRequestRef);
        if (permissionRequest === null) {
          return yield* Effect.fail(
            new Error("Expected permission request to be emitted"),
          );
        }

        yield* approvalService.permissionResponse({
          permissionResponse: {
            permissionRequestId: permissionRequest.id,
            decision: "allow",
          },
        });

        return permissionRequest;
      }),
      { rpcLayer, processLayer },
    );

    expect(result.kind).toBe("commandExecution");
    expect(result.sessionId).toBe("thread-command");
    expect(result.turnId).toBe("turn-1");
    expect(result.toolName).toBe("commandExecution");
    expect(spies.awaitingCalls).toEqual(["thread-command"]);
    expect(spies.resumedCalls).toEqual(["thread-command"]);
    expect(respondCalls).toEqual([
      {
        id: 101,
        result: {
          decision: "accept",
        },
      },
    ]);
  });

  it("maps applyPatch approval deny to abort", async () => {
    const respondCalls: RpcResponseCall[] = [];
    const spies: ProcessServiceSpies = {
      awaitingCalls: [],
      resumedCalls: [],
    };

    const rpcLayer = createRpcLayer(respondCalls);
    const processLayer = createSessionProcessLayer(spies);

    const result = await runWithApprovalService(
      Effect.gen(function* () {
        const eventBus = yield* EventBus;
        const approvalService = yield* CodexApprovalService;
        const permissionRequestRef = yield* Ref.make<PermissionRequest | null>(
          null,
        );

        yield* eventBus.on("permissionRequested", (event) => {
          Ref.set(permissionRequestRef, event.permissionRequest).pipe(
            Effect.runFork,
          );
        });

        yield* approvalService.handleRpcRequest({
          id: "rpc-202",
          method: "applyPatchApproval",
          params: {
            conversationId: "thread-patch",
            patch: "*** Begin Patch",
          },
        });

        yield* Effect.sleep("10 millis");

        const permissionRequest = yield* Ref.get(permissionRequestRef);
        if (permissionRequest === null) {
          return yield* Effect.fail(
            new Error("Expected permission request to be emitted"),
          );
        }

        yield* approvalService.permissionResponse({
          permissionResponse: {
            permissionRequestId: permissionRequest.id,
            decision: "deny",
          },
        });

        return permissionRequest;
      }),
      { rpcLayer, processLayer },
    );

    expect(result.kind).toBe("applyPatch");
    expect(result.sessionId).toBe("thread-patch");
    expect(result.toolName).toBe("applyPatch");
    expect(spies.awaitingCalls).toEqual(["thread-patch"]);
    expect(spies.resumedCalls).toEqual(["thread-patch"]);
    expect(respondCalls).toEqual([
      {
        id: "rpc-202",
        result: {
          decision: "abort",
        },
      },
    ]);
  });
});
