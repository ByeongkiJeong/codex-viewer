import { useCallback } from "react";
import { useSessionQuery } from "./useSessionQuery";

export const useSession = (projectId: string, sessionId: string) => {
  const query = useSessionQuery(projectId, sessionId);
  const session = query.data?.session;
  if (session === undefined || session === null) {
    throw new Error("Session not found");
  }

  const getToolResult = useCallback((_toolUseId: string) => {
    return undefined;
  }, []);

  return {
    session,
    conversations: session.conversations,
    getToolResult,
  };
};
