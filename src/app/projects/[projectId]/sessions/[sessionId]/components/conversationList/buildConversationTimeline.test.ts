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
      {
        role: "system",
        text: "[reasoning]\nthinking...",
        timestamp: "2026-02-10T00:32:54.108Z",
      },
    ]);
  });

  test("includes intermediate reasoning and tool execution steps", () => {
    const parsed = parseCodexJsonl(
      toJsonl([
        {
          timestamp: "2026-02-10T01:00:00.000Z",
          type: "event_msg",
          payload: {
            type: "user_message",
            message: "중간 과정도 보여줘",
          },
        },
        {
          timestamp: "2026-02-10T01:00:01.000Z",
          type: "response_item",
          payload: {
            type: "reasoning",
            summary: [{ type: "summary_text", text: "중간 확인 중..." }],
          },
        },
        {
          timestamp: "2026-02-10T01:00:02.000Z",
          type: "response_item",
          payload: {
            type: "function_call",
            name: "exec_command",
            arguments: { cmd: "pnpm test" },
          },
        },
        {
          timestamp: "2026-02-10T01:00:03.000Z",
          type: "response_item",
          payload: {
            type: "function_call_output",
            output: "Exit code: 0\nWall time: 0.3 seconds\nOutput:\nPASS",
          },
        },
        {
          timestamp: "2026-02-10T01:00:04.000Z",
          type: "response_item",
          payload: {
            type: "custom_tool_call",
            name: "apply_patch",
            input: "*** Begin Patch\n*** End Patch",
          },
        },
        {
          timestamp: "2026-02-10T01:00:05.000Z",
          type: "response_item",
          payload: {
            type: "custom_tool_call_output",
            output:
              '{"output":"Success. Updated files","metadata":{"exit_code":0}}',
          },
        },
        {
          timestamp: "2026-02-10T01:00:06.000Z",
          type: "response_item",
          payload: {
            type: "message",
            role: "assistant",
            content: [{ type: "output_text", text: "최종 답변" }],
          },
        },
      ]),
    );

    const timeline = buildConversationTimeline(parsed);

    expect(timeline).toEqual([
      {
        role: "user",
        text: "중간 과정도 보여줘",
        timestamp: "2026-02-10T01:00:00.000Z",
      },
      {
        role: "system",
        text: "[reasoning]\n중간 확인 중...",
        timestamp: "2026-02-10T01:00:01.000Z",
      },
      {
        role: "system",
        text: "[tool] exec_command",
        timestamp: "2026-02-10T01:00:02.000Z",
      },
      {
        role: "system",
        text: "[tool output] Exit code: 0",
        timestamp: "2026-02-10T01:00:03.000Z",
      },
      {
        role: "system",
        text: "[tool] apply_patch",
        timestamp: "2026-02-10T01:00:04.000Z",
      },
      {
        role: "system",
        text: "[tool output] exit_code=0",
        timestamp: "2026-02-10T01:00:05.000Z",
      },
      {
        role: "system",
        text: "최종 답변",
        timestamp: "2026-02-10T01:00:06.000Z",
      },
    ]);
  });

  test("supports camelCase payload types and deduplicates mixed-format intermediate events", () => {
    const parsed = parseCodexJsonl(
      toJsonl([
        {
          timestamp: "2026-02-10T01:10:00.000Z",
          type: "event_msg",
          payload: {
            type: "user_message",
            message: "중간 과정 포맷 변형 테스트",
          },
        },
        {
          timestamp: "2026-02-10T01:10:01.000Z",
          type: "event_msg",
          payload: {
            type: "agentReasoning",
            text: "변형 타입 reasoning",
          },
        },
        {
          timestamp: "2026-02-10T01:10:01.100Z",
          type: "event_msg",
          payload: {
            type: "agent_reasoning",
            text: "변형 타입 reasoning",
          },
        },
        {
          timestamp: "2026-02-10T01:10:02.000Z",
          type: "response_item",
          payload: {
            type: "functionCall",
            name: "exec_command",
          },
        },
        {
          timestamp: "2026-02-10T01:10:02.050Z",
          type: "response_item",
          payload: {
            type: "function_call",
            name: "exec_command",
          },
        },
        {
          timestamp: "2026-02-10T01:10:03.000Z",
          type: "response_item",
          payload: {
            type: "functionCallOutput",
            output: '{"metadata":{"exitCode":0}}',
          },
        },
        {
          timestamp: "2026-02-10T01:10:04.000Z",
          type: "response_item",
          payload: {
            type: "customToolCall",
            name: "apply_patch",
          },
        },
        {
          timestamp: "2026-02-10T01:10:05.000Z",
          type: "response_item",
          payload: {
            type: "customToolCallOutput",
            output: {
              metadata: {
                exitCode: 0,
              },
            },
          },
        },
        {
          timestamp: "2026-02-10T01:10:06.000Z",
          type: "response_item",
          payload: {
            type: "reasoning",
            text: "summary 필드 없이 text만 있는 reasoning",
          },
        },
        {
          timestamp: "2026-02-10T01:10:07.000Z",
          type: "response_item",
          payload: {
            type: "message",
            role: "assistant",
            content: [{ type: "output_text", text: "최종 답변" }],
          },
        },
      ]),
    );

    const timeline = buildConversationTimeline(parsed);

    expect(timeline).toEqual([
      {
        role: "user",
        text: "중간 과정 포맷 변형 테스트",
        timestamp: "2026-02-10T01:10:00.000Z",
      },
      {
        role: "system",
        text: "[reasoning]\n변형 타입 reasoning",
        timestamp: "2026-02-10T01:10:01.000Z",
      },
      {
        role: "system",
        text: "[tool] exec_command",
        timestamp: "2026-02-10T01:10:02.000Z",
      },
      {
        role: "system",
        text: "[tool output] exit_code=0",
        timestamp: "2026-02-10T01:10:03.000Z",
      },
      {
        role: "system",
        text: "[tool] apply_patch",
        timestamp: "2026-02-10T01:10:04.000Z",
      },
      {
        role: "system",
        text: "[tool output] exit_code=0",
        timestamp: "2026-02-10T01:10:05.000Z",
      },
      {
        role: "system",
        text: "[reasoning]\nsummary 필드 없이 text만 있는 reasoning",
        timestamp: "2026-02-10T01:10:06.000Z",
      },
      {
        role: "system",
        text: "최종 답변",
        timestamp: "2026-02-10T01:10:07.000Z",
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
