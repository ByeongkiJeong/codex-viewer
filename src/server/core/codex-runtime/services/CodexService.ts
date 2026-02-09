import { Command, Path } from "@effect/platform";
import { Context, Effect, Layer } from "effect";
import type { InferEffect } from "../../../lib/effect/types";
import { ApplicationContext } from "../../platform/services/ApplicationContext";
import { CcvOptionsService } from "../../platform/services/CcvOptionsService";
import {
  type CommandInfo,
  scanCommandFilesWithMetadata,
  scanSkillFilesWithMetadata,
} from "../functions/scanCodexCommandFiles";
import { CodexRpcClientService } from "./CodexRpcClientService";

type CodexMeta = {
  executablePath: string;
  version: string | null;
};

const parseVersion = (raw: string): string | null => {
  const line = raw.trim();
  if (line.length === 0) {
    return null;
  }

  const match = line.match(/(\d+\.\d+\.\d+(?:[-\w.]*)?)/);
  if (match?.[1]) {
    return match[1];
  }

  return line;
};

const LayerImpl = Effect.gen(function* () {
  const path = yield* Path.Path;
  const optionsService = yield* CcvOptionsService;
  const context = yield* ApplicationContext;
  const rpc = yield* CodexRpcClientService;

  const getExecutablePath = () =>
    Effect.gen(function* () {
      const fromOptions = yield* optionsService.getCcvOptions("executable");
      return fromOptions ?? "codex";
    });

  const getCodexMeta = () =>
    Effect.gen(function* () {
      const executablePath = yield* getExecutablePath();
      const versionOutput = yield* Command.string(
        Command.make(executablePath, "--version"),
      ).pipe(Effect.catchAll(() => Effect.succeed("")));

      return {
        executablePath,
        version: parseVersion(versionOutput),
      } satisfies CodexMeta;
    });

  const getAvailableFeatures = () =>
    Effect.succeed({
      appServer: true,
      toolApproval: true,
      sessionProcesses: true,
      mcpServerStatus: true,
      tasks: true,
    });

  const getMcpList = () =>
    Effect.gen(function* () {
      const fromRpc = yield* rpc
        .sendRequest("mcpServerStatus/list", {
          cursor: null,
          limit: 200,
        })
        .pipe(Effect.catchAll(() => Effect.succeed(null)));

      if (fromRpc !== null) {
        return fromRpc;
      }

      const executablePath = yield* getExecutablePath();
      const raw = yield* Command.string(
        Command.make(executablePath, "mcp", "list", "--json"),
      ).pipe(Effect.catchAll(() => Effect.succeed("[]")));

      const parsed = yield* Effect.try({
        try: () => JSON.parse(raw),
        catch: () => [],
      });
      return parsed;
    });

  const getCodexCommands = (projectPath: string) =>
    Effect.gen(function* () {
      const codexPaths = yield* context.codexPaths;
      const globalSkillsDir = codexPaths.codexSkillsDirPath;
      const vendorSkillsDir = path.join(
        codexPaths.globalCodexDirectoryPath,
        "vendor_imports",
        "skills",
      );
      const projectCommandsDir = path.resolve(
        projectPath,
        ".codex",
        "commands",
      );

      const globalSkills = yield* scanSkillFilesWithMetadata(globalSkillsDir);
      const vendorSkills = yield* scanSkillFilesWithMetadata(vendorSkillsDir);
      const projectCommands =
        yield* scanCommandFilesWithMetadata(projectCommandsDir);

      const defaultCommands: CommandInfo[] = [
        {
          name: "plan",
          description: "Create a concrete implementation plan",
          argumentHint: null,
        },
        {
          name: "review",
          description: "Review code changes for risks and regressions",
          argumentHint: null,
        },
      ];

      return {
        globalSkills,
        vendorSkills,
        projectCommands,
        defaultCommands,
      };
    });

  return {
    getCodexMeta,
    getAvailableFeatures,
    getMcpList,
    getCodexCommands,
  };
});

export type ICodexService = InferEffect<typeof LayerImpl>;
export class CodexService extends Context.Tag("CodexService")<
  CodexService,
  ICodexService
>() {
  static Live = Layer.effect(this, LayerImpl);
}
