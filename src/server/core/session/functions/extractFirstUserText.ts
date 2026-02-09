import type { ExtendedConversation } from "../../types";

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null;
};

export const extractFirstUserText = (
  conversation: ExtendedConversation,
): string | null => {
  if (conversation.type === "x-error") {
    return null;
  }

  if (conversation.type !== "response_item") {
    return null;
  }

  if (
    conversation.payload.type !== "message" ||
    conversation.payload.role !== "user"
  ) {
    return null;
  }

  const content = conversation.payload.content;
  if (!Array.isArray(content)) {
    return null;
  }

  for (const item of content) {
    if (!isRecord(item)) {
      continue;
    }

    const type = item.type;
    if (
      (type === "input_text" || type === "text" || type === "output_text") &&
      typeof item.text === "string"
    ) {
      return item.text;
    }
  }

  return null;
};
