import type { ParsedCodexLine } from "../codex-conversation-schema/parseCodexJsonl";
import { extractEditedFilePaths } from "./extractEditedFilePaths";

export type EditedFileInfo = {
  readonly filePath: string;
  readonly toolName: string;
  readonly toolUseId: string;
  readonly timestamp: string;
};

const FILE_EDITING_TOOL_NAMES = new Set([
  "apply_patch",
  "applyPatch",
  "Write",
  "Edit",
  "MultiEdit",
  "write_file",
  "edit_file",
  "multi_edit",
  "replace_in_file",
  "custom_tool_call",
]);

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null;
};

const parseArguments = (payload: Record<string, unknown>): unknown => {
  const rawArguments = payload.arguments;

  if (typeof rawArguments === "string") {
    try {
      return JSON.parse(rawArguments);
    } catch {
      return rawArguments;
    }
  }

  if (rawArguments !== undefined) {
    return rawArguments;
  }

  return payload.input;
};

const addFiles = (
  fileMap: Map<string, EditedFileInfo>,
  filePaths: readonly string[],
  toolName: string,
  toolUseId: string,
  timestamp: string,
) => {
  for (const filePath of filePaths) {
    fileMap.set(filePath, {
      filePath,
      toolName,
      toolUseId,
      timestamp,
    });
  }
};

export const extractAllEditedFiles = (
  conversations: readonly ParsedCodexLine[],
): readonly EditedFileInfo[] => {
  const fileMap = new Map<string, EditedFileInfo>();
  const pendingCallById = new Map<
    string,
    { name: string; timestamp: string; parsedInput: unknown }
  >();

  for (const [index, conversation] of conversations.entries()) {
    if (conversation.type !== "response_item") {
      continue;
    }

    const payload = conversation.payload;
    if (!isRecord(payload)) {
      continue;
    }

    const payloadType = payload.type;

    if (payloadType === "function_call" || payloadType === "custom_tool_call") {
      const callId =
        typeof payload.call_id === "string"
          ? payload.call_id
          : `${conversation.timestamp}-${index}`;

      const toolName =
        typeof payload.name === "string"
          ? payload.name
          : typeof payload.tool_name === "string"
            ? payload.tool_name
            : payload.type;

      const parsedInput = parseArguments(payload);

      pendingCallById.set(callId, {
        name: toolName,
        timestamp: conversation.timestamp,
        parsedInput,
      });

      if (FILE_EDITING_TOOL_NAMES.has(toolName)) {
        addFiles(
          fileMap,
          extractEditedFilePaths(parsedInput),
          toolName,
          callId,
          conversation.timestamp,
        );
      }

      continue;
    }

    if (payloadType !== "function_call_output") {
      continue;
    }

    const callId = payload.call_id;
    if (typeof callId !== "string") {
      continue;
    }

    const pending = pendingCallById.get(callId);
    if (!pending) {
      continue;
    }

    if (!FILE_EDITING_TOOL_NAMES.has(pending.name)) {
      continue;
    }

    const output = payload.output;
    if (typeof output !== "string") {
      continue;
    }

    addFiles(
      fileMap,
      extractEditedFilePaths(output),
      pending.name,
      callId,
      conversation.timestamp,
    );
  }

  return Array.from(fileMap.values());
};
