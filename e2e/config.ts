import { homedir } from "node:os";
import { resolve } from "node:path";
import { encodeProjectId } from "../src/server/core/project/functions/id";

// biome-ignore lint/complexity/useLiteralKeys: env var
export const globalCodexDirectoryPath = process.env["GLOBAL_CODEX_HOME"]
  ? // biome-ignore lint/complexity/useLiteralKeys: env var
    resolve(process.env["GLOBAL_CODEX_HOME"])
  : resolve(homedir(), ".codex");

export const projectIds = {
  sampleProject: encodeProjectId(
    resolve(globalCodexDirectoryPath, "projects", "sample-project"),
  ),
} as const;
