import { Trans } from "@lingui/react";
import { AlertTriangle } from "lucide-react";
import { type FC, useMemo } from "react";
import type {
  CodexLine,
  ParsedCodexLine,
} from "@/lib/codex-conversation-schema/parseCodexJsonl";
import type { SchedulerJob } from "@/server/core/scheduler/schema";
import { ScheduledMessageNotice } from "./ScheduledMessageNotice";

type ConversationListProps = {
  conversations: ParsedCodexLine[];
  scheduledJobs: SchedulerJob[];
};

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null;
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

    const type = item.type;

    if (
      (type === "input_text" || type === "output_text" || type === "text") &&
      typeof item.text === "string"
    ) {
      parts.push(item.text);
      continue;
    }

    if (type === "image") {
      parts.push("[image]");
      continue;
    }

    if (type === "input_image") {
      parts.push("[input-image]");
      continue;
    }

    if (type === "summary_text" && typeof item.text === "string") {
      parts.push(item.text);
    }
  }

  return parts.join("\n").trim();
};

const extractLineText = (line: CodexLine): string => {
  if (line.type === "response_item") {
    const payload = line.payload;

    if (payload.type === "message") {
      const text = extractTextFromMessageContent(payload.content);
      return text.length > 0 ? text : JSON.stringify(payload);
    }

    if (payload.type === "reasoning") {
      const text = extractTextFromMessageContent(payload.summary);
      return text.length > 0 ? text : "[reasoning]";
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
      return `${name}\n${argumentsText}`;
    }

    if (payload.type === "function_call_output") {
      return typeof payload.output === "string"
        ? payload.output
        : JSON.stringify(payload.output ?? {});
    }

    return JSON.stringify(payload);
  }

  if (line.type === "event_msg") {
    if (
      line.payload.type === "agent_reasoning" &&
      typeof line.payload.text === "string"
    ) {
      return line.payload.text;
    }

    if (line.payload.type === "token_count") {
      const info = line.payload.info;
      if (isRecord(info) && isRecord(info.total_token_usage)) {
        const totalTokens = info.total_token_usage.total_tokens;
        if (typeof totalTokens === "number") {
          return `token_count: ${totalTokens.toLocaleString()} total tokens`;
        }
      }
      return "token_count";
    }

    if (
      line.payload.type === "user_message" &&
      typeof line.payload.message === "string"
    ) {
      return line.payload.message;
    }

    return JSON.stringify(line.payload);
  }

  if (line.type === "turn_context") {
    return JSON.stringify(line.payload, null, 2);
  }

  if (line.type === "session_meta") {
    return JSON.stringify(line.payload, null, 2);
  }

  return JSON.stringify(line.payload);
};

const getRole = (line: CodexLine): "user" | "assistant" | "system" => {
  if (line.type === "response_item") {
    if (line.payload.type === "message" && line.payload.role === "user") {
      return "user";
    }

    if (
      line.payload.type === "message" ||
      line.payload.type === "reasoning" ||
      line.payload.type === "function_call" ||
      line.payload.type === "function_call_output" ||
      line.payload.type === "custom_tool_call"
    ) {
      return "assistant";
    }
  }

  if (line.type === "event_msg") {
    if (line.payload.type === "user_message") {
      return "user";
    }

    if (line.payload.type === "agent_reasoning") {
      return "assistant";
    }
  }

  return "system";
};

const roleClasses: Record<"user" | "assistant" | "system", string> = {
  user: "ml-auto bg-primary text-primary-foreground",
  assistant: "mr-auto bg-muted",
  system: "mx-auto bg-muted/40 border border-border/60",
};

const timestampForLine = (line: CodexLine): string => {
  const date = new Date(line.timestamp);
  if (Number.isNaN(date.getTime())) {
    return line.timestamp;
  }

  return date.toLocaleString();
};

const conversationKey = (conversation: ParsedCodexLine): string => {
  if (conversation.type === "x-error") {
    return `error-${conversation.line}`;
  }

  return `${conversation.timestamp}-${conversation.type}-${extractLineText(conversation)}`;
};

export const ConversationList: FC<ConversationListProps> = ({
  conversations,
  scheduledJobs,
}) => {
  const normalized = useMemo(() => conversations, [conversations]);

  return (
    <ul className="space-y-3 pt-4">
      <li>
        <ScheduledMessageNotice scheduledJobs={scheduledJobs} />
      </li>

      {normalized.map((conversation) => {
        if (conversation.type === "x-error") {
          return (
            <li key={conversationKey(conversation)} className="w-full">
              <div className="mx-auto max-w-3xl rounded-lg border border-red-300 bg-red-50 p-3">
                <div className="mb-2 flex items-center gap-2 text-red-700">
                  <AlertTriangle className="h-4 w-4" />
                  <span className="text-xs font-semibold">
                    <Trans id="conversation.error.schema" />
                  </span>
                </div>
                <pre className="max-h-64 overflow-auto text-xs whitespace-pre-wrap break-words text-red-900">
                  {conversation.line}
                </pre>
              </div>
            </li>
          );
        }

        const role = getRole(conversation);
        const text = extractLineText(conversation);

        return (
          <li key={conversationKey(conversation)} className="w-full">
            <div
              className={`max-w-3xl rounded-xl px-3 py-2 ${roleClasses[role]}`}
            >
              <div className="mb-1 text-[10px] opacity-70">
                {timestampForLine(conversation)}
              </div>
              <pre className="text-sm whitespace-pre-wrap break-words font-sans">
                {text}
              </pre>
            </div>
          </li>
        );
      })}
    </ul>
  );
};
