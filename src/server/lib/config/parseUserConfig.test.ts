import { describe, expect, test } from "vitest";
import { parseUserConfig } from "./parseUserConfig";

describe("parseUserConfig", () => {
  test("defaults enter key behavior to enter-send", () => {
    const parsed = parseUserConfig(undefined);

    expect(parsed.enterKeyBehavior).toBe("enter-send");
  });

  test("migrates legacy shift-enter-send to enter-send", () => {
    const parsed = parseUserConfig(
      JSON.stringify({
        enterKeyBehavior: "shift-enter-send",
      }),
    );

    expect(parsed.enterKeyBehavior).toBe("enter-send");
  });

  test("preserves explicit command-enter-send", () => {
    const parsed = parseUserConfig(
      JSON.stringify({
        enterKeyBehavior: "command-enter-send",
      }),
    );

    expect(parsed.enterKeyBehavior).toBe("command-enter-send");
  });
});
