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
      if (line.payload.type !== "user_message") {
        continue;
      }

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

    if (line.type !== "response_item") {
      continue;
    }

    if (line.payload.type !== "message") {
      continue;
    }

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
  }

  return entries;
};
