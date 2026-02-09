export type PublicSessionProcess = {
  id: string;
  projectId: string;
  sessionId: string;
  status: "running" | "paused" | "awaiting_approval" | "completed";
};
