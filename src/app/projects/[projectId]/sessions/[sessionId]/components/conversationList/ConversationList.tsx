import { ChevronDownIcon, ChevronRightIcon, LoaderIcon } from "lucide-react";
import { type FC, useCallback, useMemo, useState } from "react";
import type { ParsedCodexLine } from "@/lib/codex-conversation-schema/parseCodexJsonl";
import type { SchedulerJob } from "@/server/core/scheduler/schema";
import { buildConversationTimeline } from "./buildConversationTimeline";
import {
  buildConversationDisplayItems,
  type IntermediateDetail,
} from "./conversationDisplay";
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

const phaseLabelByType: Record<IntermediateDetail["phase"], string> = {
  reasoning: "reasoning",
  tool: "tool",
  tool_output: "tool output",
};

const intermediateDetailKey = (
  detail: IntermediateDetail,
  index: number,
): string => {
  return `${detail.timestamp}-${detail.phase}-${index}-${detail.text}`;
};

export const ConversationList: FC<ConversationListProps> = ({
  conversations,
  scheduledJobs,
}) => {
  const [expandedIntermediateIds, setExpandedIntermediateIds] = useState<
    ReadonlySet<string>
  >(() => new Set());

  const displayItems = useMemo(() => {
    const timeline = buildConversationTimeline(conversations);
    return buildConversationDisplayItems(timeline);
  }, [conversations]);

  const toggleIntermediate = useCallback((id: string) => {
    setExpandedIntermediateIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  return (
    <ul className="space-y-3 pt-4">
      <li>
        <ScheduledMessageNotice scheduledJobs={scheduledJobs} />
      </li>

      {displayItems.map((item) => {
        if (item.type === "intermediate") {
          const isExpanded = expandedIntermediateIds.has(item.id);
          return (
            <li key={item.id} className="w-full">
              <div className="mr-auto max-w-[72%]">
                <button
                  type="button"
                  onClick={() => toggleIntermediate(item.id)}
                  className="group rounded-full border border-dashed border-border/60 bg-muted/25 p-1.5 text-muted-foreground transition-colors hover:bg-muted/40"
                  aria-expanded={isExpanded}
                  aria-label="Toggle intermediate details"
                >
                  <span className="flex items-center gap-1">
                    <LoaderIcon className="h-3 w-3 animate-spin" />
                    {isExpanded ? (
                      <ChevronDownIcon className="h-3 w-3 opacity-70" />
                    ) : (
                      <ChevronRightIcon className="h-3 w-3 opacity-70" />
                    )}
                  </span>
                </button>

                {isExpanded && (
                  <div className="mt-1 space-y-1 rounded-lg border border-border/40 bg-muted/20 px-2 py-2 text-[11px] text-muted-foreground">
                    {item.details.map((detail, index) => (
                      <div
                        key={intermediateDetailKey(detail, index)}
                        className="flex items-start gap-2"
                      >
                        <span className="shrink-0 rounded border border-border/40 bg-background/50 px-1 py-0.5 text-[9px] uppercase tracking-wide">
                          {phaseLabelByType[detail.phase]}
                        </span>
                        <span className="min-w-0 break-words">
                          {detail.text}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </li>
          );
        }

        const conversation = item.message;
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
              className={`max-w-[85%] rounded-xl px-3 py-2 ${roleClasses[conversation.role]}`}
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
