const FILE_PATH_KEYS = new Set([
  "file_path",
  "path",
  "target_file",
  "targetPath",
  "filepath",
  "file",
]);

const FILE_EDITING_TOOL_NAMES = new Set([
  "Write",
  "Edit",
  "MultiEdit",
  "apply_patch",
  "applyPatch",
  "write_file",
  "edit_file",
  "multi_edit",
  "replace_in_file",
  "custom_tool_call",
]);

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null;
};

const collectFromRecord = (
  value: Record<string, unknown>,
  acc: Set<string>,
) => {
  for (const [key, nested] of Object.entries(value)) {
    if (FILE_PATH_KEYS.has(key)) {
      if (typeof nested === "string" && nested.length > 0) {
        acc.add(nested);
      }
      continue;
    }

    if (Array.isArray(nested)) {
      for (const item of nested) {
        if (typeof item === "string" && item.length > 0) {
          if (key === "paths" || key === "files") {
            acc.add(item);
          }
          continue;
        }

        if (isRecord(item)) {
          collectFromRecord(item, acc);
        }
      }
      continue;
    }

    if (isRecord(nested)) {
      collectFromRecord(nested, acc);
    }
  }
};

const parsePatchPaths = (patch: string): string[] => {
  const paths = new Set<string>();
  const pathPattern =
    /^\*\*\* (?:Add File|Update File|Delete File|Move to):\s+(.+)$/gm;
  let match = pathPattern.exec(patch);
  while (match !== null) {
    const candidate = match[1]?.trim();
    if (candidate && candidate.length > 0) {
      paths.add(candidate);
    }
    match = pathPattern.exec(patch);
  }
  return Array.from(paths);
};

/**
 * Extracts edited file paths from codex tool input.
 */
export const extractEditedFilePaths = (toolInput: unknown): string[] => {
  if (typeof toolInput === "string") {
    return parsePatchPaths(toolInput);
  }

  if (!isRecord(toolInput)) {
    return [];
  }

  const toolName =
    typeof toolInput.name === "string"
      ? toolInput.name
      : typeof toolInput.tool_name === "string"
        ? toolInput.tool_name
        : null;
  if (toolName !== null && !FILE_EDITING_TOOL_NAMES.has(toolName)) {
    return [];
  }

  const payload =
    isRecord(toolInput.input) && toolInput.type === "tool_use"
      ? toolInput.input
      : toolInput;

  const paths = new Set<string>();
  collectFromRecord(payload, paths);

  const patch = payload.patch;
  if (typeof patch === "string") {
    for (const patchPath of parsePatchPaths(patch)) {
      paths.add(patchPath);
    }
  }

  return Array.from(paths);
};
