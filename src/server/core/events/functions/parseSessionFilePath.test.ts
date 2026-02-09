import { describe, expect, it } from "vitest";
import { parseSessionFilePath } from "./parseSessionFilePath";

describe("parseSessionFilePath", () => {
  it("parses codex rollout file path and extracts thread id", () => {
    const result = parseSessionFilePath(
      "2026/02/09/rollout-2026-02-09T14-22-58-019c40da-5d02-7203-81ce-f2c89a07220e.jsonl",
    );

    expect(result).toEqual({
      type: "session",
      threadId: "019c40da-5d02-7203-81ce-f2c89a07220e",
      sessionId: "019c40da-5d02-7203-81ce-f2c89a07220e",
    });
  });

  it("accepts rollout path without date prefix", () => {
    const result = parseSessionFilePath(
      "rollout-2026-02-09T14-22-58-019c40da-5d02-7203-81ce-f2c89a07220e.jsonl",
    );

    expect(result?.threadId).toBe("019c40da-5d02-7203-81ce-f2c89a07220e");
  });

  it("returns null for non-rollout files", () => {
    expect(parseSessionFilePath("project/session.jsonl")).toBeNull();
    expect(parseSessionFilePath("rollout-foo.json")).toBeNull();
    expect(parseSessionFilePath("")).toBeNull();
  });
});
