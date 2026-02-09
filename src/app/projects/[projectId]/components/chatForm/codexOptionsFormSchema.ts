import { z } from "zod";
import type { CodexTurnOptionsSchema } from "@/server/core/codex-runtime/schema";

export const codexOptionsFormSchema = z.object({
  model: z.string().optional(),
  approvalPolicy: z
    .enum(["untrusted", "on-failure", "on-request", "never"])
    .optional(),
  sandboxMode: z
    .enum(["readOnly", "workspaceWrite", "dangerFullAccess"])
    .optional(),
  writableRootsText: z.string().optional(),
  networkAccess: z.boolean().optional(),
  env: z.record(z.string(), z.string().optional()).optional(),
});

export type CodexOptionsForm = z.infer<typeof codexOptionsFormSchema>;

const DEFAULT_CODEX_TURN_OPTIONS: CodexTurnOptionsSchema = {
  model: "gpt-5-codex",
};

export function getDefaultCodexTurnOptions(): CodexTurnOptionsSchema {
  return {
    ...DEFAULT_CODEX_TURN_OPTIONS,
  };
}

const trimOrUndefined = (value: string | undefined): string | undefined => {
  if (value === undefined) {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const parseWritableRoots = (
  value: string | undefined,
): string[] | undefined => {
  if (value === undefined) {
    return undefined;
  }

  const roots = value
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  return roots.length > 0 ? roots : undefined;
};

export function transformFormToSchema(
  form: CodexOptionsForm,
): CodexTurnOptionsSchema | undefined {
  const model = trimOrUndefined(form.model) ?? DEFAULT_CODEX_TURN_OPTIONS.model;
  const writableRoots = parseWritableRoots(form.writableRootsText);
  const env =
    form.env && Object.keys(form.env).length > 0 ? form.env : undefined;

  const result: CodexTurnOptionsSchema = {
    model,
    ...(form.approvalPolicy ? { approvalPolicy: form.approvalPolicy } : {}),
    ...(form.sandboxMode ? { sandboxMode: form.sandboxMode } : {}),
    ...(writableRoots ? { writableRoots } : {}),
    ...(form.networkAccess !== undefined
      ? { networkAccess: form.networkAccess }
      : {}),
    ...(env ? { env } : {}),
  };

  return result;
}

export function transformSchemaToForm(
  schema: CodexTurnOptionsSchema | undefined,
): CodexOptionsForm {
  if (schema === undefined) {
    return {
      model: DEFAULT_CODEX_TURN_OPTIONS.model,
    };
  }

  return {
    model: schema.model,
    approvalPolicy: schema.approvalPolicy,
    sandboxMode: schema.sandboxMode,
    writableRootsText: schema.writableRoots?.join("\n"),
    networkAccess: schema.networkAccess,
    env: schema.env,
  };
}

export function hasNonDefaultCodexTurnOptions(
  options: CodexTurnOptionsSchema | undefined,
): boolean {
  if (options === undefined) {
    return false;
  }

  const model = options.model ?? DEFAULT_CODEX_TURN_OPTIONS.model;

  return (
    model !== DEFAULT_CODEX_TURN_OPTIONS.model ||
    options.approvalPolicy !== undefined ||
    options.sandboxMode !== undefined ||
    options.writableRoots !== undefined ||
    options.networkAccess !== undefined ||
    options.env !== undefined
  );
}
