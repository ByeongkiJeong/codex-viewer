import { z } from "zod";
import { parsedUserMessageSchema } from "./functions/parseUserMessage";

export const tokenUsageSchema = z.object({
  inputTokens: z.number(),
  cachedInputTokens: z.number(),
  outputTokens: z.number(),
  reasoningOutputTokens: z.number(),
  totalTokens: z.number(),
});

export const sessionMetaSchema = z.object({
  messageCount: z.number(),
  firstUserMessage: parsedUserMessageSchema.nullable(),
  tokenUsage: tokenUsageSchema,
  modelName: z.string().nullable(),
});
