import { Context, Effect, Layer } from "effect";
import type { ControllerResponse } from "../../../lib/effect/toEffectResponse";
import type { InferEffect } from "../../../lib/effect/types";
import { decodeProjectId } from "../../project/functions/id";
import { CodexService } from "../services/CodexService";

const LayerImpl = Effect.gen(function* () {
  const codexService = yield* CodexService;

  const getCodexCommands = (options: { projectId: string }) =>
    Effect.gen(function* () {
      const projectPath = decodeProjectId(options.projectId);
      const commands = yield* codexService.getCodexCommands(projectPath);

      return {
        status: 200,
        response: commands,
      } as const satisfies ControllerResponse;
    });

  const getMcpListRoute = () =>
    Effect.gen(function* () {
      const servers = yield* codexService.getMcpList();
      return {
        status: 200,
        response: {
          servers,
        },
      } as const satisfies ControllerResponse;
    });

  const getCodexMeta = () =>
    Effect.gen(function* () {
      const meta = yield* codexService.getCodexMeta();
      return {
        status: 200,
        response: meta,
      } as const satisfies ControllerResponse;
    });

  const getAvailableFeatures = () =>
    Effect.gen(function* () {
      const features = yield* codexService.getAvailableFeatures();
      const featuresList = Object.entries(features).map(([name, enabled]) => ({
        name,
        enabled,
      }));

      return {
        status: 200,
        response: {
          features: featuresList,
        },
      } as const satisfies ControllerResponse;
    });

  return {
    getCodexCommands,
    getMcpListRoute,
    getCodexMeta,
    getAvailableFeatures,
  };
});

export type ICodexController = InferEffect<typeof LayerImpl>;
export class CodexController extends Context.Tag("CodexController")<
  CodexController,
  ICodexController
>() {
  static Live = Layer.effect(this, LayerImpl);
}
