import { describe, expect, test } from "vitest";
import { extractLatestTokenUsage, parseCodexJsonl } from "./parseCodexJsonl";

const buildSampleJsonl = () => {
  return [
    JSON.stringify({
      timestamp: "2026-01-01T10:00:00.000Z",
      type: "session_meta",
      payload: {
        id: "thread-1",
        timestamp: "2026-01-01T10:00:00.000Z",
        cwd: "/tmp/project",
        originator: "codex_cli_rs",
        cli_version: "0.72.0",
        source: "cli",
        model_provider: "openai",
      },
    }),
    JSON.stringify({
      timestamp: "2026-01-01T10:00:01.000Z",
      type: "turn_context",
      payload: {
        cwd: "/tmp/project",
        approval_policy: "on-request",
        sandbox_policy: { type: "workspace-write" },
        model: "gpt-5-codex",
        summary: "auto",
      },
    }),
    JSON.stringify({
      timestamp: "2026-01-01T10:00:02.000Z",
      type: "response_item",
      payload: {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "hello" }],
      },
    }),
    JSON.stringify({
      timestamp: "2026-01-01T10:00:03.000Z",
      type: "event_msg",
      payload: {
        type: "token_count",
        info: {
          total_token_usage: {
            input_tokens: 120,
            cached_input_tokens: 12,
            output_tokens: 20,
            reasoning_output_tokens: 8,
            total_tokens: 140,
          },
        },
      },
    }),
    JSON.stringify({
      timestamp: "2026-01-01T10:00:04.000Z",
      type: "compacted",
      payload: {
        summary: "compacted",
      },
    }),
  ].join("\n");
};

describe("parseCodexJsonl", () => {
  test("decodes known top-level codex entries", () => {
    const parsed = parseCodexJsonl(buildSampleJsonl());

    expect(parsed).toHaveLength(5);
    expect(parsed[0]).toMatchObject({ type: "session_meta" });
    expect(parsed[1]).toMatchObject({ type: "turn_context" });
    expect(parsed[2]).toMatchObject({ type: "response_item" });
    expect(parsed[3]).toMatchObject({ type: "event_msg" });
    expect(parsed[4]).toMatchObject({ type: "compacted" });
  });

  test("keeps malformed lines as parse errors", () => {
    const jsonl = `${buildSampleJsonl()}\n{invalid-json}`;
    const parsed = parseCodexJsonl(jsonl);
    const last = parsed.at(-1);

    expect(last).toBeDefined();
    expect(last).toMatchObject({
      type: "x-error",
      lineNumber: 6,
    });
  });
});

describe("extractLatestTokenUsage", () => {
  test("returns latest total token usage from token_count events", () => {
    const jsonl = [
      JSON.stringify({
        timestamp: "2026-01-01T10:00:00.000Z",
        type: "event_msg",
        payload: {
          type: "token_count",
          info: {
            total_token_usage: {
              input_tokens: 100,
              cached_input_tokens: 20,
              output_tokens: 30,
              reasoning_output_tokens: 5,
              total_tokens: 135,
            },
          },
        },
      }),
      JSON.stringify({
        timestamp: "2026-01-01T10:00:02.000Z",
        type: "event_msg",
        payload: {
          type: "token_count",
          info: {
            total_token_usage: {
              input_tokens: 150,
              cached_input_tokens: 40,
              output_tokens: 70,
              reasoning_output_tokens: 10,
              total_tokens: 230,
            },
          },
        },
      }),
    ].join("\n");

    const usage = extractLatestTokenUsage(parseCodexJsonl(jsonl));

    expect(usage).toEqual({
      inputTokens: 150,
      cachedInputTokens: 40,
      outputTokens: 70,
      reasoningOutputTokens: 10,
      totalTokens: 230,
    });
  });

  test("returns zeros when token_count info is missing", () => {
    const jsonl = JSON.stringify({
      timestamp: "2026-01-01T10:00:00.000Z",
      type: "event_msg",
      payload: {
        type: "token_count",
        info: null,
      },
    });

    const usage = extractLatestTokenUsage(parseCodexJsonl(jsonl));

    expect(usage).toEqual({
      inputTokens: 0,
      cachedInputTokens: 0,
      outputTokens: 0,
      reasoningOutputTokens: 0,
      totalTokens: 0,
    });
  });
});
