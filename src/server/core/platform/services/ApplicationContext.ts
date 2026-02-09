import { homedir } from "node:os";
import { Path } from "@effect/platform";
import { Effect, Context as EffectContext, Layer } from "effect";
import type { InferEffect } from "../../../lib/effect/types";
import { CcvOptionsService } from "./CcvOptionsService";

export type CodexPaths = {
  globalCodexDirectoryPath: string;
  codexSkillsDirPath: string;
  codexSessionsDirPath: string;
  codexTasksDirPath: string;
};

const LayerImpl = Effect.gen(function* () {
  const path = yield* Path.Path;
  const ccvOptionsService = yield* CcvOptionsService;

  const codexPaths = Effect.gen(function* () {
    const globalCodexDirectoryPath = yield* ccvOptionsService
      .getCcvOptions("codexHome")
      .pipe(
        Effect.map((envVar) =>
          envVar === undefined
            ? path.resolve(homedir(), ".codex")
            : path.resolve(envVar),
        ),
      );

    return {
      globalCodexDirectoryPath,
      codexSkillsDirPath: path.resolve(globalCodexDirectoryPath, "skills"),
      codexSessionsDirPath: path.resolve(globalCodexDirectoryPath, "sessions"),
      codexTasksDirPath: path.resolve(globalCodexDirectoryPath, "tasks"),
    } as const satisfies CodexPaths;
  });

  return {
    codexPaths,
  };
});

export type IApplicationContext = InferEffect<typeof LayerImpl>;
export class ApplicationContext extends EffectContext.Tag("ApplicationContext")<
  ApplicationContext,
  IApplicationContext
>() {
  static Live = Layer.effect(this, LayerImpl);
}
