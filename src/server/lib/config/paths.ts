import { homedir } from "node:os";
import { resolve } from "node:path";

export const codexViewerCacheDirPath = resolve(
  homedir(),
  ".codex-viewer",
  "cache",
);
