import type { ExtendedConversation } from "../../types";

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null;
};

const extractTextContent = (content: unknown): string => {
  if (!Array.isArray(content)) {
    return "";
  }

  const texts: string[] = [];

  for (const item of content) {
    if (!isRecord(item)) {
      continue;
    }

    const type = item.type;
    if (
      (type === "input_text" || type === "output_text" || type === "text") &&
      typeof item.text === "string"
    ) {
      texts.push(item.text);
    }

    if (type === "summary_text" && typeof item.text === "string") {
      texts.push(item.text);
    }
  }

  return texts.join(" ").trim();
};

export const extractSearchableText = (
  conversation: ExtendedConversation,
): string | null => {
  if (conversation.type === "x-error") {
    return null;
  }

  if (conversation.type === "response_item") {
    const payload = conversation.payload;

    if (payload.type === "message") {
      const text = extractTextContent(payload.content);
      return text.length > 0 ? text : null;
    }

    if (payload.type === "reasoning") {
      const text = extractTextContent(payload.summary);
      return text.length > 0 ? text : null;
    }

    if (
      payload.type === "function_call" ||
      payload.type === "custom_tool_call"
    ) {
      const name = typeof payload.name === "string" ? payload.name : "tool";
      const argumentsText =
        typeof payload.arguments === "string"
          ? payload.arguments
          : JSON.stringify(payload.arguments ?? payload.input ?? {});
      return `${name} ${argumentsText}`.trim();
    }

    if (payload.type === "function_call_output") {
      if (typeof payload.output === "string") {
        return payload.output;
      }
      return JSON.stringify(payload.output ?? {});
    }

    return null;
  }

  if (conversation.type === "event_msg") {
    if (
      conversation.payload.type === "user_message" &&
      typeof conversation.payload.message === "string"
    ) {
      return conversation.payload.message;
    }

    if (
      conversation.payload.type === "agent_reasoning" &&
      typeof conversation.payload.text === "string"
    ) {
      return conversation.payload.text;
    }
  }

  return null;
};
