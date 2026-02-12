import type { ConversationTimelineItem } from "./buildConversationTimeline";

export type IntermediatePhase = "reasoning" | "tool" | "tool_output";
export type IntermediateDetail = {
  phase: IntermediatePhase;
  text: string;
  timestamp: string;
};

export type ConversationDisplayItem =
  | {
      type: "message";
      message: ConversationTimelineItem;
    }
  | {
      type: "intermediate";
      id: string;
      timestamp: string;
      details: readonly IntermediateDetail[];
    };

const detectIntermediatePhase = (
  item: ConversationTimelineItem,
): IntermediatePhase | null => {
  if (item.role !== "system") {
    return null;
  }

  if (item.text.startsWith("[reasoning]")) {
    return "reasoning";
  }

  if (item.text.startsWith("[tool output]")) {
    return "tool_output";
  }

  if (item.text.startsWith("[tool]")) {
    return "tool";
  }

  return null;
};

const summarizeIntermediateText = (
  text: string,
  phase: IntermediatePhase,
): string => {
  const prefixByPhase: Record<IntermediatePhase, RegExp> = {
    reasoning: /^\[reasoning\]\s*/i,
    tool: /^\[tool\]\s*/i,
    tool_output: /^\[tool output\]\s*/i,
  };

  const phaseLabelByType: Record<IntermediatePhase, string> = {
    reasoning: "reasoning",
    tool: "tool",
    tool_output: "tool output",
  };

  const withoutPrefix = text.replace(prefixByPhase[phase], "");
  const normalized = withoutPrefix.replace(/\s+/g, " ").trim();

  if (normalized.length === 0) {
    return phaseLabelByType[phase];
  }

  const maxSummaryLength = 120;
  if (normalized.length <= maxSummaryLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxSummaryLength - 3)}...`;
};

export const buildConversationDisplayItems = (
  timeline: readonly ConversationTimelineItem[],
): ConversationDisplayItem[] => {
  const items: ConversationDisplayItem[] = [];
  let pendingIntermediate: {
    firstTimestamp: string;
    lastTimestamp: string;
    details: IntermediateDetail[];
  } | null = null;

  const flushIntermediate = () => {
    if (pendingIntermediate === null) {
      return;
    }

    const id = `${pendingIntermediate.firstTimestamp}-${pendingIntermediate.lastTimestamp}`;
    items.push({
      type: "intermediate",
      id,
      timestamp: pendingIntermediate.firstTimestamp,
      details: pendingIntermediate.details,
    });

    pendingIntermediate = null;
  };

  for (const message of timeline) {
    const phase = detectIntermediatePhase(message);
    if (phase !== null) {
      if (pendingIntermediate === null) {
        pendingIntermediate = {
          firstTimestamp: message.timestamp,
          lastTimestamp: message.timestamp,
          details: [
            {
              phase,
              text: summarizeIntermediateText(message.text, phase),
              timestamp: message.timestamp,
            },
          ],
        };
      } else {
        pendingIntermediate.details.push({
          phase,
          text: summarizeIntermediateText(message.text, phase),
          timestamp: message.timestamp,
        });
        pendingIntermediate.lastTimestamp = message.timestamp;
      }

      continue;
    }

    flushIntermediate();
    items.push({
      type: "message",
      message,
    });
  }

  flushIntermediate();

  return items;
};
