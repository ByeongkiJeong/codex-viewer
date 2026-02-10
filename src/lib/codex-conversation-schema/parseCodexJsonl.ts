import { z } from "zod";
import { isInternalBootstrapMessage } from "./isInternalBootstrapMessage";

const codexTopLevelTypeSchema = z.enum([
  "session_meta",
  "turn_context",
  "response_item",
  "event_msg",
  "compacted",
]);

const sessionMetaPayloadSchema = z
  .object({
    id: z.string(),
    timestamp: z.string(),
    cwd: z.string(),
    model_provider: z.string().optional(),
    cli_version: z.string().optional(),
    source: z.string().optional(),
  })
  .passthrough();

const turnContextPayloadSchema = z
  .object({
    cwd: z.string().optional(),
    model: z.string().optional(),
    approval_policy: z.string().optional(),
    sandbox_policy: z.unknown().optional(),
    summary: z.string().optional(),
  })
  .passthrough();

const responseItemPayloadSchema = z
  .object({
    type: z.string(),
  })
  .passthrough();

const eventMsgPayloadSchema = z
  .object({
    type: z.string(),
  })
  .passthrough();

const compactedPayloadSchema = z.object({}).passthrough();

const sessionMetaLineSchema = z.object({
  timestamp: z.string(),
  type: z.literal("session_meta"),
  payload: sessionMetaPayloadSchema,
});

const turnContextLineSchema = z.object({
  timestamp: z.string(),
  type: z.literal("turn_context"),
  payload: turnContextPayloadSchema,
});

const responseItemLineSchema = z.object({
  timestamp: z.string(),
  type: z.literal("response_item"),
  payload: responseItemPayloadSchema,
});

const eventMsgLineSchema = z.object({
  timestamp: z.string(),
  type: z.literal("event_msg"),
  payload: eventMsgPayloadSchema,
});

const compactedLineSchema = z.object({
  timestamp: z.string(),
  type: z.literal("compacted"),
  payload: compactedPayloadSchema,
});

const codexLineSchema = z.discriminatedUnion("type", [
  sessionMetaLineSchema,
  turnContextLineSchema,
  responseItemLineSchema,
  eventMsgLineSchema,
  compactedLineSchema,
]);

const tokenUsageSchema = z.object({
  input_tokens: z.number(),
  cached_input_tokens: z.number(),
  output_tokens: z.number(),
  reasoning_output_tokens: z.number(),
  total_tokens: z.number(),
});

const tokenCountPayloadSchema = z
  .object({
    type: z.literal("token_count"),
    info: z
      .object({
        total_token_usage: tokenUsageSchema.optional(),
      })
      .nullable()
      .optional(),
  })
  .passthrough();

const userMessageContentItemSchema = z
  .object({
    type: z.string(),
    text: z.string().optional(),
  })
  .passthrough();

const userMessagePayloadSchema = z
  .object({
    type: z.literal("message"),
    role: z.literal("user"),
    content: z.array(userMessageContentItemSchema).optional(),
  })
  .passthrough();

const userMessageEventPayloadSchema = z
  .object({
    type: z.literal("user_message"),
    message: z.string(),
  })
  .passthrough();

export type CodexTokenUsage = {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
  totalTokens: number;
};

export type CodexLine = z.infer<typeof codexLineSchema>;

export type CodexParseErrorLine = {
  type: "x-error";
  line: string;
  lineNumber: number;
};

export type ParsedCodexLine = CodexLine | CodexParseErrorLine;

export const parseCodexJsonl = (content: string): ParsedCodexLine[] => {
  const lines = content
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const parsedLines: ParsedCodexLine[] = [];

  for (const [index, line] of lines.entries()) {
    try {
      const raw = JSON.parse(line);

      const typeSafe = codexTopLevelTypeSchema.safeParse(
        getRecordField(raw, "type"),
      );

      if (!typeSafe.success) {
        parsedLines.push({
          type: "x-error",
          line,
          lineNumber: index + 1,
        });
        continue;
      }

      const parsed = codexLineSchema.safeParse(raw);

      if (!parsed.success) {
        parsedLines.push({
          type: "x-error",
          line,
          lineNumber: index + 1,
        });
        continue;
      }

      parsedLines.push(parsed.data);
    } catch {
      parsedLines.push({
        type: "x-error",
        line,
        lineNumber: index + 1,
      });
    }
  }

  return parsedLines;
};

const zeroTokenUsage = (): CodexTokenUsage => {
  return {
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    reasoningOutputTokens: 0,
    totalTokens: 0,
  };
};

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null;
};

const getRecordField = (value: unknown, key: string): unknown => {
  if (!isRecord(value)) {
    return undefined;
  }

  if (!(key in value)) {
    return undefined;
  }
  return value[key];
};

export const extractLatestTokenUsage = (
  lines: readonly ParsedCodexLine[],
): CodexTokenUsage => {
  let latest = zeroTokenUsage();

  for (const line of lines) {
    if (line.type !== "event_msg") {
      continue;
    }

    const parsedPayload = tokenCountPayloadSchema.safeParse(line.payload);
    if (!parsedPayload.success) {
      continue;
    }

    const usage = parsedPayload.data.info?.total_token_usage;
    if (!usage) {
      continue;
    }

    latest = {
      inputTokens: usage.input_tokens,
      cachedInputTokens: usage.cached_input_tokens,
      outputTokens: usage.output_tokens,
      reasoningOutputTokens: usage.reasoning_output_tokens,
      totalTokens: usage.total_tokens,
    };
  }

  return latest;
};

export const extractFirstUserInputText = (
  lines: readonly ParsedCodexLine[],
): string | null => {
  for (const line of lines) {
    const text =
      line.type === "response_item"
        ? extractTextFromUserResponseItem(line.payload)
        : line.type === "event_msg"
          ? extractTextFromUserMessageEvent(line.payload)
          : null;

    if (text === null || isInternalBootstrapMessage(text)) {
      continue;
    }

    return text;
  }

  return null;
};

const extractTextFromUserResponseItem = (payload: unknown): string | null => {
  const parsedPayload = userMessagePayloadSchema.safeParse(payload);
  if (!parsedPayload.success) {
    return null;
  }

  const messageContent = parsedPayload.data.content;
  if (!messageContent || messageContent.length === 0) {
    return null;
  }

  for (const item of messageContent) {
    if (item.type !== "input_text") {
      continue;
    }

    const text = item.text?.trim();
    if (text && text.length > 0) {
      return text;
    }
  }

  return null;
};

const extractTextFromUserMessageEvent = (payload: unknown): string | null => {
  const parsedPayload = userMessageEventPayloadSchema.safeParse(payload);
  if (!parsedPayload.success) {
    return null;
  }

  const text = parsedPayload.data.message.trim();
  if (text.length === 0) {
    return null;
  }

  return text;
};

export const extractLatestModelName = (
  lines: readonly ParsedCodexLine[],
): string | null => {
  let latestModelName: string | null = null;

  for (const line of lines) {
    if (line.type !== "turn_context") {
      continue;
    }

    if (line.payload.model && line.payload.model.length > 0) {
      latestModelName = line.payload.model;
    }
  }

  return latestModelName;
};

export const extractThreadId = (
  lines: readonly ParsedCodexLine[],
): string | null => {
  for (const line of lines) {
    if (line.type === "session_meta") {
      return line.payload.id;
    }
  }

  return null;
};

export const extractCwd = (
  lines: readonly ParsedCodexLine[],
): string | null => {
  for (const line of lines) {
    if (line.type === "session_meta") {
      return line.payload.cwd;
    }
  }

  for (const line of lines) {
    if (line.type === "turn_context" && line.payload.cwd) {
      return line.payload.cwd;
    }
  }

  return null;
};
