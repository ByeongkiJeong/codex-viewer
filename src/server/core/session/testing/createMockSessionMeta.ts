import type { SessionMeta } from "../../types";

/**
 * Creates a mock SessionMeta object for testing purposes with default token usage.
 */
export function createMockSessionMeta(
  overrides: Partial<SessionMeta> = {},
): SessionMeta {
  return {
    messageCount: 0,
    firstUserMessage: null,
    tokenUsage: {
      inputTokens: 0,
      cachedInputTokens: 0,
      outputTokens: 0,
      reasoningOutputTokens: 0,
      totalTokens: 0,
    },
    modelName: null,
    ...overrides,
  };
}
