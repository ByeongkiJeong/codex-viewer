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

  const payloadType = getString(payload, "type");
  if (payloadType === "web_search_call") {
    return "web_search";
  }

  return "tool";
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
      const metadata = parsedJson.metadata;
      if (isRecord(metadata) && typeof metadata.exit_code === "number") {
        return `exit_code=${metadata.exit_code}`;
      }
    }

    const firstLine = lines.at(0);
    if (!firstLine) {
      return null;
    }

    return sanitizeSensitive(normalizeWhitespace(firstLine));
  }

  if (isRecord(output)) {
    const metadata = output.metadata;
    if (isRecord(metadata) && typeof metadata.exit_code === "number") {
      return `exit_code=${metadata.exit_code}`;
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
      if (line.payload.type === "user_message") {
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

      if (line.payload.type !== "agent_reasoning") {
        continue;
      }

      const reasoning = getString(line.payload, "text");
      if (reasoning === null) {
        continue;
      }

      const text = reasoning.trim();
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

    if (line.payload.type === "message") {
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

    if (line.payload.type === "reasoning") {
      const text = extractTextFromMessageContent(line.payload.summary);
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
      line.payload.type === "function_call" ||
      line.payload.type === "custom_tool_call" ||
      line.payload.type === "web_search_call"
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
      line.payload.type === "function_call_output" ||
      line.payload.type === "custom_tool_call_output"
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
