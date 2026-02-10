import { describe, expect, test } from "vitest";
import { parseCodexJsonl } from "../../../../../../../lib/codex-conversation-schema/parseCodexJsonl";
import { buildConversationTimeline } from "./buildConversationTimeline";

const toJsonl = (lines: ReadonlyArray<Record<string, unknown>>) => {
  return lines.map((line) => JSON.stringify(line)).join("\n");
};

describe("buildConversationTimeline", () => {
  test("filters system noise and duplicate turns from codex raw events", () => {
    const parsed = parseCodexJsonl(
      toJsonl([
        {
          timestamp: "2026-02-10T00:32:50.080Z",
          type: "session_meta",
          payload: {
            id: "thread-1",
            timestamp: "2026-02-10T00:32:50.064Z",
            cwd: "/tmp",
          },
        },
        {
          timestamp: "2026-02-10T00:32:50.080Z",
          type: "response_item",
          payload: {
            type: "message",
            role: "user",
            content: [{ type: "input_text", text: "안녕?" }],
          },
        },
        {
          timestamp: "2026-02-10T00:32:50.080Z",
          type: "event_msg",
          payload: {
            type: "user_message",
            message: "안녕?",
          },
        },
        {
          timestamp: "2026-02-10T00:32:50.081Z",
          type: "event_msg",
          payload: {
            type: "token_count",
            info: {
              total_token_usage: {
                input_tokens: 100,
                cached_input_tokens: 20,
                output_tokens: 30,
                reasoning_output_tokens: 10,
                total_tokens: 160,
              },
            },
          },
        },
        {
          timestamp: "2026-02-10T00:32:54.105Z",
          type: "event_msg",
          payload: {
            type: "agent_message",
            message: "Codex입니다.",
          },
        },
        {
          timestamp: "2026-02-10T00:32:54.105Z",
          type: "response_item",
          payload: {
            type: "message",
            role: "assistant",
            content: [{ type: "output_text", text: "Codex입니다." }],
          },
        },
        {
          timestamp: "2026-02-10T00:32:54.108Z",
          type: "response_item",
          payload: {
            type: "reasoning",
            summary: [{ type: "summary_text", text: "thinking..." }],
          },
        },
        {
          timestamp: "2026-02-10T00:32:54.109Z",
          type: "turn_context",
          payload: {
            cwd: "/tmp",
          },
        },
      ]),
    );

    const timeline = buildConversationTimeline(parsed);

    expect(timeline).toEqual([
      {
        role: "user",
        text: "안녕?",
        timestamp: "2026-02-10T00:32:50.080Z",
      },
      {
        role: "system",
        text: "Codex입니다.",
        timestamp: "2026-02-10T00:32:54.105Z",
      },
    ]);
  });

  test("keeps normal user message when event_msg.user_message does not exist", () => {
    const parsed = parseCodexJsonl(
      toJsonl([
        {
          timestamp: "2026-02-10T00:33:00.000Z",
          type: "response_item",
          payload: {
            type: "message",
            role: "user",
            content: [{ type: "input_text", text: "실제 질문" }],
          },
        },
        {
          timestamp: "2026-02-10T00:33:01.000Z",
          type: "response_item",
          payload: {
            type: "message",
            role: "assistant",
            content: [{ type: "output_text", text: "실제 답변" }],
          },
        },
      ]),
    );

    const timeline = buildConversationTimeline(parsed);

    expect(timeline).toEqual([
      {
        role: "user",
        text: "실제 질문",
        timestamp: "2026-02-10T00:33:00.000Z",
      },
      {
        role: "system",
        text: "실제 답변",
        timestamp: "2026-02-10T00:33:01.000Z",
      },
    ]);
  });

  test("drops bootstrap/internal user context messages", () => {
    const parsed = parseCodexJsonl(
      toJsonl([
        {
          timestamp: "2026-02-10T00:34:00.000Z",
          type: "response_item",
          payload: {
            type: "message",
            role: "user",
            content: [
              { type: "input_text", text: "# AGENTS.md instructions for /tmp" },
            ],
          },
        },
        {
          timestamp: "2026-02-10T00:34:00.100Z",
          type: "response_item",
          payload: {
            type: "message",
            role: "user",
            content: [
              {
                type: "input_text",
                text: "<environment_context>\n  <cwd>/tmp</cwd>\n</environment_context>",
              },
            ],
          },
        },
        {
          timestamp: "2026-02-10T00:34:01.000Z",
          type: "event_msg",
          payload: {
            type: "user_message",
            message: "진짜 질문",
          },
        },
        {
          timestamp: "2026-02-10T00:34:02.000Z",
          type: "response_item",
          payload: {
            type: "message",
            role: "assistant",
            content: [{ type: "output_text", text: "진짜 답변" }],
          },
        },
      ]),
    );

    const timeline = buildConversationTimeline(parsed);

    expect(timeline).toEqual([
      {
        role: "user",
        text: "진짜 질문",
        timestamp: "2026-02-10T00:34:01.000Z",
      },
      {
        role: "system",
        text: "진짜 답변",
        timestamp: "2026-02-10T00:34:02.000Z",
      },
    ]);
  });
});
