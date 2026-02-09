import type { ParsedCodexLine } from "../codex-conversation-schema/parseCodexJsonl";

export type ToolCallInfo = {
  readonly id: string;
  readonly name: string;
  readonly timestamp: string;
  readonly inputSummary: string;
};

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null;
};

const summarizeInput = (input: unknown): string => {
  if (input === null || input === undefined) {
    return "";
  }

  if (typeof input === "string") {
    return input.slice(0, 120);
  }

  if (!isRecord(input)) {
    return String(input).slice(0, 120);
  }

  const filePath = input.file_path;
  if (typeof filePath === "string") {
    return filePath;
  }

  const command = input.command;
  if (typeof command === "string") {
    return command.slice(0, 120);
  }

  const keys = Object.keys(input).slice(0, 4);
  return keys.join(", ");
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

const isToolCallPayload = (
  payload: unknown,
): payload is Record<string, unknown> => {
  if (!isRecord(payload)) {
    return false;
  }

  const type = payload.type;
  return type === "function_call" || type === "custom_tool_call";
};

export const extractToolCalls = (
  conversations: readonly ParsedCodexLine[],
): readonly ToolCallInfo[] => {
  const toolCalls: ToolCallInfo[] = [];

  for (const [index, conversation] of conversations.entries()) {
    if (conversation.type !== "response_item") {
      continue;
    }

    if (!isToolCallPayload(conversation.payload)) {
      continue;
    }

    const callId =
      typeof conversation.payload.call_id === "string"
        ? conversation.payload.call_id
        : `${conversation.timestamp}-${index}`;

    const name =
      typeof conversation.payload.name === "string"
        ? conversation.payload.name
        : typeof conversation.payload.tool_name === "string"
          ? conversation.payload.tool_name
          : "tool";

    const parsedInput = parseArguments(conversation.payload);

    toolCalls.push({
      id: callId,
      name,
      timestamp: conversation.timestamp,
      inputSummary: summarizeInput(parsedInput),
    });
  }

  return toolCalls;
};
