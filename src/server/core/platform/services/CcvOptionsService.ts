import { Context, Effect, Layer, Ref } from "effect";
import type { InferEffect } from "../../../lib/effect/types";

export type CliOptions = {
  port: string;
  hostname: string;
  password?: string | undefined;
  executable?: string | undefined;
  codexHome?: string | undefined;
  terminalDisabled?: boolean | undefined;
  terminalShell?: string | undefined;
  terminalUnrestricted?: boolean | undefined;
};

export type CcvOptions = {
  port: number;
  hostname: string;
  password?: string | undefined;
  executable?: string | undefined;
  codexHome?: string | undefined;
  terminalDisabled?: boolean | undefined;
  terminalShell?: string | undefined;
  terminalUnrestricted?: boolean | undefined;
};

const getOptionalEnv = (key: string): string | undefined => {
  // biome-ignore lint/style/noProcessEnv: allow only here
  return process.env[key] ?? undefined;
};

const isFlagEnabled = (value: string | undefined) => {
  if (!value) return false;
  return value === "1" || value.toLowerCase() === "true";
};

let sharedCcvOptions: CcvOptions | undefined;

const resolveCcvOptions = (
  cliOptions?: Partial<CliOptions> | undefined,
): CcvOptions => {
  const parsedPort = Number.parseInt(
    cliOptions?.port ?? getOptionalEnv("PORT") ?? "3000",
    10,
  );

  return {
    port: Number.isNaN(parsedPort) ? 3000 : parsedPort,
    hostname: cliOptions?.hostname ?? getOptionalEnv("HOSTNAME") ?? "localhost",
    password:
      cliOptions?.password ?? getOptionalEnv("CCV_PASSWORD") ?? undefined,
    executable:
      cliOptions?.executable ??
      getOptionalEnv("CCV_CODEX_EXECUTABLE_PATH") ??
      undefined,
    codexHome: cliOptions?.codexHome ?? getOptionalEnv("CCV_GLOBAL_CODEX_HOME"),
    terminalDisabled:
      cliOptions?.terminalDisabled ??
      (isFlagEnabled(getOptionalEnv("CCV_TERMINAL_DISABLED"))
        ? true
        : undefined),
    terminalShell:
      cliOptions?.terminalShell ??
      getOptionalEnv("CCV_TERMINAL_SHELL") ??
      undefined,
    terminalUnrestricted:
      cliOptions?.terminalUnrestricted ??
      (isFlagEnabled(getOptionalEnv("CCV_TERMINAL_UNRESTRICTED"))
        ? true
        : undefined),
  };
};

const LayerImpl = Effect.gen(function* () {
  const ccvOptionsRef = yield* Ref.make<CcvOptions>(
    sharedCcvOptions ?? resolveCcvOptions(),
  );

  const loadCliOptions = (cliOptions: CliOptions) => {
    return Effect.gen(function* () {
      const resolved = resolveCcvOptions(cliOptions);
      sharedCcvOptions = resolved;
      yield* Ref.set(ccvOptionsRef, resolved);
    });
  };

  const getCcvOptions = <K extends keyof CcvOptions>(key: K) => {
    return Effect.gen(function* () {
      const localOptions = yield* Ref.get(ccvOptionsRef);
      const options = sharedCcvOptions ?? localOptions;
      return options[key];
    });
  };

  return {
    loadCliOptions,
    getCcvOptions,
  };
});

export type ICcvOptionsService = InferEffect<typeof LayerImpl>;

export class CcvOptionsService extends Context.Tag("CcvOptionsService")<
  CcvOptionsService,
  ICcvOptionsService
>() {
  static Live = Layer.effect(this, LayerImpl);
}
