const rolloutFileRegExp =
  /(?:^|\/)rollout-[^/]*-(?<threadId>[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i;

export type SessionFileMatch = {
  type: "session";
  threadId: string;
  sessionId: string;
};

export type FileMatch = SessionFileMatch | null;

/**
 * Parses a codex rollout file path.
 *
 * @param filePath - The relative file path from the codex sessions directory
 * @returns Session match with threadId/sessionId, or null if the path is not a rollout jsonl file
 */
export const parseSessionFilePath = (filePath: string): FileMatch => {
  const match = filePath.match(rolloutFileRegExp);
  const threadId = match?.groups?.threadId;
  if (threadId === undefined) {
    return null;
  }

  return {
    type: "session",
    threadId,
    sessionId: threadId,
  };
};
