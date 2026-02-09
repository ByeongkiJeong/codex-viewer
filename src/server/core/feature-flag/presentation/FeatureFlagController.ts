import { Context, Effect, Layer } from "effect";
import type { ControllerResponse } from "../../../lib/effect/toEffectResponse";
import type { InferEffect } from "../../../lib/effect/types";
import { CodexService } from "../../codex-runtime/services/CodexService";
import type { Flag } from "../models/flag";

const LayerImpl = Effect.gen(function* () {
  const codexService = yield* CodexService;

  const getFlags = () =>
    Effect.gen(function* () {
      const codexFeatures = yield* codexService.getAvailableFeatures();

      return {
        response: {
          flags: [
            {
              name: "app-server",
              enabled: codexFeatures.appServer,
            },
            {
              name: "tool-approval",
              enabled: codexFeatures.toolApproval,
            },
            {
              name: "session-processes",
              enabled: codexFeatures.sessionProcesses,
            },
            {
              name: "mcp-server-status",
              enabled: codexFeatures.mcpServerStatus,
            },
            {
              name: "tasks",
              enabled: codexFeatures.tasks,
            },
          ] satisfies Flag[],
        },
        status: 200,
      } as const satisfies ControllerResponse;
    });

  return {
    getFlags,
  };
});

export type IFeatureFlagController = InferEffect<typeof LayerImpl>;
export class FeatureFlagController extends Context.Tag("FeatureFlagController")<
  FeatureFlagController,
  IFeatureFlagController
>() {
  static Live = Layer.effect(this, LayerImpl);
}
