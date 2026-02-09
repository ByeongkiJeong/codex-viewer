import { describe, expect, test } from "vitest";
import type { CodexTurnOptionsSchema } from "@/server/core/codex-runtime/schema";
import {
  getDefaultCodexTurnOptions,
  hasNonDefaultCodexTurnOptions,
  transformFormToSchema,
  transformSchemaToForm,
} from "./codexOptionsFormSchema";

describe("codexOptionsFormSchema", () => {
  test("getDefaultCodexTurnOptions returns the stable default model", () => {
    const result = getDefaultCodexTurnOptions();
    expect(result).toEqual({ model: "gpt-5-codex" });
  });

  test("transformSchemaToForm returns default model for undefined options", () => {
    const result = transformSchemaToForm(undefined);
    expect(result).toEqual({ model: "gpt-5-codex" });
  });

  test("transformFormToSchema returns default model for empty form", () => {
    const result = transformFormToSchema({});
    expect(result).toEqual({ model: "gpt-5-codex" });
  });

  test("transformFormToSchema trims model and parses writable roots", () => {
    const result = transformFormToSchema({
      model: "  gpt-5-codex  ",
      approvalPolicy: "on-request",
      sandboxMode: "workspaceWrite",
      writableRootsText: " /repo \n\n /tmp/work ",
      networkAccess: false,
      env: { NODE_ENV: "test", EMPTY: undefined },
    });

    expect(result).toEqual({
      model: "gpt-5-codex",
      approvalPolicy: "on-request",
      sandboxMode: "workspaceWrite",
      writableRoots: ["/repo", "/tmp/work"],
      networkAccess: false,
      env: { NODE_ENV: "test", EMPTY: undefined },
    });
  });

  test("transformSchemaToForm maps writableRoots to newline text", () => {
    const schema: CodexTurnOptionsSchema = {
      model: "gpt-5-codex",
      approvalPolicy: "never",
      sandboxMode: "readOnly",
      writableRoots: ["/repo", "/workspace"],
      networkAccess: true,
      env: { FOO: "bar" },
    };

    const result = transformSchemaToForm(schema);
    expect(result).toEqual({
      model: "gpt-5-codex",
      approvalPolicy: "never",
      sandboxMode: "readOnly",
      writableRootsText: "/repo\n/workspace",
      networkAccess: true,
      env: { FOO: "bar" },
    });
  });

  test("hasNonDefaultCodexTurnOptions detects only non-empty options", () => {
    expect(hasNonDefaultCodexTurnOptions(undefined)).toBe(false);
    expect(hasNonDefaultCodexTurnOptions({})).toBe(false);
    expect(hasNonDefaultCodexTurnOptions({ model: "gpt-5-codex" })).toBe(false);
    expect(hasNonDefaultCodexTurnOptions({ model: "gpt-5" })).toBe(true);
  });
});
