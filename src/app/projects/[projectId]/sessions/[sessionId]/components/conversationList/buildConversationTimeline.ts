import { isInternalBootstrapMessage } from "../../../../../../../lib/codex-conversation-schema/isInternalBootstrapMessage";
import type { ParsedCodexLine } from "../../../../../../../lib/codex-conversation-schema/parseCodexJsonl";

export type ConversationTimelineItem = {
  role: "user" | "system";
  text: string;
  timestamp: string;
};

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null;
};

const getString = (
  record: Record<string, unknown>,
  key: string,
): string | null => {
  const value = record[key];
  return typeof value === "string" ? value : null;
};

const normalizePayloadType = (value: string | null): string | null => {
  if (value === null) {
    return null;
  }

  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
};

const normalizeWhitespace = (value: string): string => {
  return value.replace(/\s+/g, " ").trim();
};

const sanitizeSensitive = (value: string): string => {
  return value
    .replace(/https?:\/\/([^/\s:@]+):([^@/\s]+)@/g, "https://$1:***@")
    .replace(/\bgithub_pat_[A-Za-z0-9_]+\b/g, "github_pat_***");
};

const parseJsonRecord = (value: string): Record<string, unknown> | null => {
  try {
    const parsed: unknown = JSON.parse(value);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

const extractTextFromMessageContent = (content: unknown): string => {
  if (!Array.isArray(content)) {
    return "";
  }

  const parts: string[] = [];
  for (const item of content) {
    if (!isRecord(item)) {
      continue;
    }

    const itemType = item.type;
    const text = getString(item, "text");

    if (
      (itemType === "input_text" ||
        itemType === "output_text" ||
        itemType === "text" ||
        itemType === "summary_text") &&
      text !== null
    ) {
      parts.push(text);
      continue;
    }

    if (itemType === "image") {
      parts.push("[image]");
      continue;
    }

    if (itemType === "input_image") {
      parts.push("[input-image]");
    }
  }

  return parts.join("\n").trim();
};

const extractReasoningText = (payload: Record<string, unknown>): string => {
  const text = getString(payload, "text");
  if (text !== null) {
    const trimmed = text.trim();
    if (trimmed.length > 0) {
      return trimmed;
    }
  }

  const summary = extractTextFromMessageContent(payload.summary);
  if (summary.length > 0) {
    return summary;
  }

  return extractTextFromMessageContent(payload.content);
};

const formatReasoning = (text: string): string => {
  return `[reasoning]\n${text}`.trim();
};

const getToolName = (payload: Record<string, unknown>): string => {
  const name = getString(payload, "name");
  if (name !== null && name.length > 0) {
    return sanitizeSensitive(name);
  }

  const toolName = getString(payload, "tool_name");
  if (toolName !== null && toolName.length > 0) {
    return sanitizeSensitive(toolName);
  }

  const payloadType = normalizePayloadType(getString(payload, "type"));
  if (payloadType === "websearchcall") {
    return "web_search";
  }

  return "tool";
};

const readExitCode = (record: Record<string, unknown>): number | null => {
  const snakeCase = record.exit_code;
  if (typeof snakeCase === "number") {
    return snakeCase;
  }

  const camelCase = record.exitCode;
  if (typeof camelCase === "number") {
    return camelCase;
  }

  return null;
};

const summarizeToolOutput = (
  payload: Record<string, unknown>,
): string | null => {
  const output = payload.output;

  if (typeof output === "string") {
    const trimmed = output.trim();
    if (trimmed.length === 0) {
      return null;
    }

    const lines = trimmed
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    const exitCodeLine = lines.find((line) =>
      line.toLowerCase().startsWith("exit code:"),
    );

    if (exitCodeLine) {
      return sanitizeSensitive(normalizeWhitespace(exitCodeLine));
    }

    const parsedJson = parseJsonRecord(trimmed);
    if (parsedJson !== null) {
      const parsedExitCode = readExitCode(parsedJson);
      if (parsedExitCode !== null) {
        return `exit_code=${parsedExitCode}`;
      }

      const metadata = parsedJson.metadata;
      if (isRecord(metadata)) {
        const metadataExitCode = readExitCode(metadata);
        if (metadataExitCode !== null) {
          return `exit_code=${metadataExitCode}`;
        }
      }
    }

    const firstLine = lines.at(0);
    if (!firstLine) {
      return null;
    }

    return sanitizeSensitive(normalizeWhitespace(firstLine));
  }

  if (isRecord(output)) {
    const outputExitCode = readExitCode(output);
    if (outputExitCode !== null) {
      return `exit_code=${outputExitCode}`;
    }

    const metadata = output.metadata;
    if (isRecord(metadata)) {
      const metadataExitCode = readExitCode(metadata);
      if (metadataExitCode !== null) {
        return `exit_code=${metadataExitCode}`;
      }
    }

    return "output available";
  }

  if (typeof output === "number") {
    return `output=${output}`;
  }

  return null;
};

const appendDeduplicated = (
  entries: ConversationTimelineItem[],
  next: ConversationTimelineItem,
) => {
  const last = entries.at(-1);
  if (last && last.role === next.role && last.text === next.text) {
    return;
  }

  entries.push(next);
};

export const buildConversationTimeline = (
  lines: readonly ParsedCodexLine[],
): ConversationTimelineItem[] => {
  const entries: ConversationTimelineItem[] = [];

  for (const line of lines) {
    if (line.type === "x-error") {
      continue;
    }

    if (line.type === "event_msg") {
      const payloadType = normalizePayloadType(getString(line.payload, "type"));

      if (payloadType === "usermessage") {
        const message = getString(line.payload, "message");
        if (message === null) {
          continue;
        }

        const text = message.trim();
        if (text.length === 0) {
          continue;
        }

        appendDeduplicated(entries, {
          role: "user",
          text,
          timestamp: line.timestamp,
        });
        continue;
      }

      if (payloadType !== "agentreasoning") {
        continue;
      }

      const text = extractReasoningText(line.payload);
      if (text.length === 0) {
        continue;
      }

      appendDeduplicated(entries, {
        role: "system",
        text: formatReasoning(text),
        timestamp: line.timestamp,
      });
      continue;
    }

    if (line.type !== "response_item") {
      continue;
    }

    const payloadType = normalizePayloadType(getString(line.payload, "type"));

    if (payloadType === "message") {
      const role = getString(line.payload, "role");
      if (role === null) {
        continue;
      }

      const text = extractTextFromMessageContent(line.payload.content);
      if (text.length === 0) {
        continue;
      }

      if (role === "assistant") {
        appendDeduplicated(entries, {
          role: "system",
          text,
          timestamp: line.timestamp,
        });
        continue;
      }

      if (role === "user" && !isInternalBootstrapMessage(text)) {
        appendDeduplicated(entries, {
          role: "user",
          text,
          timestamp: line.timestamp,
        });
      }
      continue;
    }

    if (payloadType === "reasoning") {
      const text = extractReasoningText(line.payload);
      if (text.length === 0) {
        continue;
      }

      appendDeduplicated(entries, {
        role: "system",
        text: formatReasoning(text),
        timestamp: line.timestamp,
      });
      continue;
    }

    if (
      payloadType === "functioncall" ||
      payloadType === "customtoolcall" ||
      payloadType === "websearchcall"
    ) {
      const name = getToolName(line.payload);
      appendDeduplicated(entries, {
        role: "system",
        text: `[tool] ${name}`,
        timestamp: line.timestamp,
      });
      continue;
    }

    if (
      payloadType === "functioncalloutput" ||
      payloadType === "customtoolcalloutput" ||
      payloadType === "websearchcalloutput"
    ) {
      const summary = summarizeToolOutput(line.payload);
      const text =
        summary === null ? "[tool output]" : `[tool output] ${summary}`;
      appendDeduplicated(entries, {
        role: "system",
        text,
        timestamp: line.timestamp,
      });
    }
  }

  return entries;
};
