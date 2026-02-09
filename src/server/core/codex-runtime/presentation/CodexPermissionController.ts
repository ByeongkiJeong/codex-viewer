import { Context, Effect, Layer } from "effect";
import type { PermissionResponse } from "../../../../types/permissions";
import type { ControllerResponse } from "../../../lib/effect/toEffectResponse";
import type { InferEffect } from "../../../lib/effect/types";
import { CodexApprovalService } from "../services/CodexApprovalService";

const LayerImpl = Effect.gen(function* () {
  const approvalService = yield* CodexApprovalService;

  const permissionResponse = (options: {
    permissionResponse: PermissionResponse;
  }) =>
    Effect.gen(function* () {
      const response = yield* approvalService.permissionResponse({
        permissionResponse: options.permissionResponse,
      });

      return {
        status: 200,
        response,
      } as const satisfies ControllerResponse;
    });

  return {
    permissionResponse,
  };
});

export type ICodexPermissionController = InferEffect<typeof LayerImpl>;
export class CodexPermissionController extends Context.Tag(
  "CodexPermissionController",
)<CodexPermissionController, ICodexPermissionController>() {
  static Live = Layer.effect(this, LayerImpl);
}
