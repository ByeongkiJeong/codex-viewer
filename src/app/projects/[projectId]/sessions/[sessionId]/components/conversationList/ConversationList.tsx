import { type FC, useMemo } from "react";
import type { ParsedCodexLine } from "@/lib/codex-conversation-schema/parseCodexJsonl";
import type { SchedulerJob } from "@/server/core/scheduler/schema";
import { buildConversationTimeline } from "./buildConversationTimeline";
import { ScheduledMessageNotice } from "./ScheduledMessageNotice";

type ConversationListProps = {
  conversations: ParsedCodexLine[];
  scheduledJobs: SchedulerJob[];
};

const roleClasses: Record<"user" | "system", string> = {
  user: "ml-auto bg-primary text-primary-foreground",
  system: "mr-auto bg-muted",
};

const timestampForConversation = (timestamp: string): string => {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return timestamp;
  }

  return date.toLocaleString();
};

const conversationKey = (
  role: "user" | "system",
  timestamp: string,
  text: string,
): string => {
  return `${timestamp}-${role}-${text}`;
};

export const ConversationList: FC<ConversationListProps> = ({
  conversations,
  scheduledJobs,
}) => {
  const timeline = useMemo(() => {
    return buildConversationTimeline(conversations);
  }, [conversations]);

  return (
    <ul className="space-y-3 pt-4">
      <li>
        <ScheduledMessageNotice scheduledJobs={scheduledJobs} />
      </li>

      {timeline.map((conversation) => {
        return (
          <li
            key={conversationKey(
              conversation.role,
              conversation.timestamp,
              conversation.text,
            )}
            className="w-full"
          >
            <div
              className={`max-w-3xl rounded-xl px-3 py-2 ${roleClasses[conversation.role]}`}
            >
              <div className="mb-1 text-[10px] opacity-70">
                {timestampForConversation(conversation.timestamp)}
              </div>
              <pre className="text-sm whitespace-pre-wrap break-words font-sans">
                {conversation.text}
              </pre>
            </div>
          </li>
        );
      })}
    </ul>
  );
};
