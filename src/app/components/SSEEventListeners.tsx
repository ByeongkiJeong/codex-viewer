import { useQueryClient } from "@tanstack/react-query";
import type { FC, PropsWithChildren } from "react";
import { projectDetailQuery, sessionDetailQuery } from "../../lib/api/queries";
import { useServerEventListener } from "../../lib/sse/hook/useServerEventListener";

export const SSEEventListeners: FC<PropsWithChildren> = ({ children }) => {
  const queryClient = useQueryClient();

  useServerEventListener("sessionListChanged", async (event) => {
    await queryClient.invalidateQueries({
      queryKey: projectDetailQuery(event.projectId).queryKey,
    });
  });

  useServerEventListener("sessionChanged", async (event) => {
    await queryClient.invalidateQueries({
      queryKey: sessionDetailQuery(event.projectId, event.sessionId).queryKey,
    });
  });

  // Listen for virtual conversation updates - triggers before file watcher debounce
  // This reduces perceived latency by refreshing session data as soon as new assistant message is received
  useServerEventListener("virtualConversationUpdated", async (event) => {
    await queryClient.invalidateQueries({
      queryKey: sessionDetailQuery(event.projectId, event.sessionId).queryKey,
    });
  });

  return <>{children}</>;
};
