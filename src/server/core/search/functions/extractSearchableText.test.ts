import { describe, expect, it } from "vitest";
import { extractSearchableText } from "./extractSearchableText";

describe("extractSearchableText", () => {
  it("extracts user message text from codex response_item", () => {
    const result = extractSearchableText({
      type: "response_item",
      timestamp: "2026-01-01T00:00:00.000Z",
      payload: {
        type: "message",
        role: "user",
        content: [
          {
            type: "input_text",
            text: "hello codex",
          },
        ],
      },
    });

    expect(result).toBe("hello codex");
  });

  it("extracts assistant reasoning text", () => {
    const result = extractSearchableText({
      type: "event_msg",
      timestamp: "2026-01-01T00:00:00.000Z",
      payload: {
        type: "agent_reasoning",
        text: "planning response",
      },
    });

    expect(result).toBe("planning response");
  });

  it("returns null for error entries", () => {
    const result = extractSearchableText({
      type: "x-error",
      line: "{bad json}",
      lineNumber: 1,
    });

    expect(result).toBeNull();
  });

  it("extracts function call payload as searchable text", () => {
    const result = extractSearchableText({
      type: "response_item",
      timestamp: "2026-01-01T00:00:00.000Z",
      payload: {
        type: "function_call",
        name: "shell_command",
        arguments: '{"command":"ls"}',
      },
    });

    expect(result).toContain("shell_command");
    expect(result).toContain("ls");
  });
});
