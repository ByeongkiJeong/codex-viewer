import { describe, expect, test } from "vitest";
import { buildConversationDisplayItems } from "./conversationDisplay";

describe("buildConversationDisplayItems", () => {
  test("compresses consecutive intermediate system entries into a single low-priority item", () => {
    const items = buildConversationDisplayItems([
      {
        role: "user",
        text: "Run checks",
        timestamp: "2026-02-12T00:00:00.000Z",
      },
      {
        role: "system",
        text: "[reasoning]\nChecking requirements",
        timestamp: "2026-02-12T00:00:01.000Z",
      },
      {
        role: "system",
        text: "[tool] exec_command",
        timestamp: "2026-02-12T00:00:02.000Z",
      },
      {
        role: "system",
        text: "[tool output] exit_code=0",
        timestamp: "2026-02-12T00:00:03.000Z",
      },
      {
        role: "system",
        text: "Done. Everything passed.",
        timestamp: "2026-02-12T00:00:04.000Z",
      },
    ]);

    expect(items).toEqual([
      {
        type: "message",
        message: {
          role: "user",
          text: "Run checks",
          timestamp: "2026-02-12T00:00:00.000Z",
        },
      },
      {
        type: "intermediate",
        id: "2026-02-12T00:00:01.000Z-2026-02-12T00:00:03.000Z",
        timestamp: "2026-02-12T00:00:01.000Z",
        details: [
          {
            phase: "reasoning",
            text: "Checking requirements",
            timestamp: "2026-02-12T00:00:01.000Z",
          },
          {
            phase: "tool",
            text: "exec_command",
            timestamp: "2026-02-12T00:00:02.000Z",
          },
          {
            phase: "tool_output",
            text: "exit_code=0",
            timestamp: "2026-02-12T00:00:03.000Z",
          },
        ],
      },
      {
        type: "message",
        message: {
          role: "system",
          text: "Done. Everything passed.",
          timestamp: "2026-02-12T00:00:04.000Z",
        },
      },
    ]);
  });

  test("starts a new intermediate block after a normal message", () => {
    const items = buildConversationDisplayItems([
      {
        role: "system",
        text: "[tool] exec_command",
        timestamp: "2026-02-12T00:01:00.000Z",
      },
      {
        role: "system",
        text: "First result",
        timestamp: "2026-02-12T00:01:01.000Z",
      },
      {
        role: "system",
        text: "[reasoning]\nSecond round",
        timestamp: "2026-02-12T00:01:02.000Z",
      },
    ]);

    expect(items).toEqual([
      {
        type: "intermediate",
        id: "2026-02-12T00:01:00.000Z-2026-02-12T00:01:00.000Z",
        timestamp: "2026-02-12T00:01:00.000Z",
        details: [
          {
            phase: "tool",
            text: "exec_command",
            timestamp: "2026-02-12T00:01:00.000Z",
          },
        ],
      },
      {
        type: "message",
        message: {
          role: "system",
          text: "First result",
          timestamp: "2026-02-12T00:01:01.000Z",
        },
      },
      {
        type: "intermediate",
        id: "2026-02-12T00:01:02.000Z-2026-02-12T00:01:02.000Z",
        timestamp: "2026-02-12T00:01:02.000Z",
        details: [
          {
            phase: "reasoning",
            text: "Second round",
            timestamp: "2026-02-12T00:01:02.000Z",
          },
        ],
      },
    ]);
  });
});
