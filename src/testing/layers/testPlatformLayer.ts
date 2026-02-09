import { resolve } from "node:path";
import { Path } from "@effect/platform";
import { Effect, Layer } from "effect";
import { DEFAULT_LOCALE } from "../../lib/i18n/localeDetection";
import { EventBus } from "../../server/core/events/services/EventBus";
import type { EnvSchema } from "../../server/core/platform/schema";
import {
  ApplicationContext,
  type CodexPaths,
} from "../../server/core/platform/services/ApplicationContext";
import {
  type CcvOptions,
  CcvOptionsService,
} from "../../server/core/platform/services/CcvOptionsService";
import { EnvService } from "../../server/core/platform/services/EnvService";
import { UserConfigService } from "../../server/core/platform/services/UserConfigService";
import type { UserConfig } from "../../server/lib/config/config";

const codexHomeForTest = resolve(process.cwd(), "mock-global-codex-dir");

export const testPlatformLayer = (overrides?: {
  codexPaths?: Partial<CodexPaths>;
  env?: Partial<EnvSchema>;
  userConfig?: Partial<UserConfig>;
  ccvOptions?: Partial<CcvOptions>;
}) => {
  const resolvedCcvOptions: CcvOptions = {
    port: overrides?.ccvOptions?.port ?? 3401,
    hostname: overrides?.ccvOptions?.hostname ?? "localhost",
    password: overrides?.ccvOptions?.password,
    executable: overrides?.ccvOptions?.executable,
    codexHome: overrides?.ccvOptions?.codexHome,
    terminalDisabled: overrides?.ccvOptions?.terminalDisabled,
    terminalShell: overrides?.ccvOptions?.terminalShell,
    terminalUnrestricted: overrides?.ccvOptions?.terminalUnrestricted,
  };

  const resolvedEnv: EnvSchema = {
    CCV_ENV: overrides?.env?.CCV_ENV ?? "development",
    NEXT_PHASE: overrides?.env?.NEXT_PHASE ?? "phase-test",
    PATH: overrides?.env?.PATH,
    SHELL: overrides?.env?.SHELL,
    CCV_TERMINAL_SHELL: overrides?.env?.CCV_TERMINAL_SHELL,
    CCV_TERMINAL_UNRESTRICTED: overrides?.env?.CCV_TERMINAL_UNRESTRICTED,
    CCV_TERMINAL_DISABLED: overrides?.env?.CCV_TERMINAL_DISABLED,
  };

  const applicationContextLayer = Layer.mock(ApplicationContext, {
    codexPaths: Effect.succeed({
      globalCodexDirectoryPath: resolve(codexHomeForTest),
      codexSkillsDirPath: resolve(codexHomeForTest, "skills"),
      codexSessionsDirPath: resolve(codexHomeForTest, "sessions"),
      codexTasksDirPath: resolve(codexHomeForTest, "tasks"),
      ...overrides?.codexPaths,
    }),
  });

  const ccvOptionsServiceLayer = Layer.mock(CcvOptionsService, {
    getCcvOptions: <Key extends keyof CcvOptions>(key: Key) =>
      Effect.succeed(resolvedCcvOptions[key]),
  });

  const envServiceLayer = Layer.mock(EnvService, {
    getEnv: <Key extends keyof EnvSchema>(key: Key) =>
      Effect.succeed(resolvedEnv[key]),
  });

  const userConfigServiceLayer = Layer.mock(UserConfigService, {
    setUserConfig: () => Effect.succeed(undefined),
    getUserConfig: () =>
      Effect.succeed<UserConfig>({
        hideNoUserMessageSession:
          overrides?.userConfig?.hideNoUserMessageSession ?? true,
        unifySameTitleSession:
          overrides?.userConfig?.unifySameTitleSession ?? true,
        enterKeyBehavior:
          overrides?.userConfig?.enterKeyBehavior ?? "shift-enter-send",
        permissionMode: overrides?.userConfig?.permissionMode ?? "default",
        locale: overrides?.userConfig?.locale ?? DEFAULT_LOCALE,
        theme: overrides?.userConfig?.theme ?? "system",
        searchHotkey: overrides?.userConfig?.searchHotkey ?? "command-k",
        autoScheduleContinueOnRateLimit:
          overrides?.userConfig?.autoScheduleContinueOnRateLimit ?? false,
      }),
  });

  return Layer.mergeAll(
    applicationContextLayer,
    userConfigServiceLayer,
    EventBus.Live,
    ccvOptionsServiceLayer,
    envServiceLayer,
    Path.layer,
  );
};
