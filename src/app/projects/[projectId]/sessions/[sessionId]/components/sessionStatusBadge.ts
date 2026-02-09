type SessionStatus =
  | "paused"
  | "running"
  | "awaiting_approval"
  | "completed"
  | undefined;

type SessionStatusBadgeProps = {
  labelId:
    | "session.status.running"
    | "session.status.paused"
    | "session.status.awaiting_approval"
    | "session.status.completed";
  className: string;
  icon: "paused" | "running" | "awaiting_approval" | "completed";
};

export const getSessionStatusBadgeProps = (
  status: SessionStatus,
): SessionStatusBadgeProps | undefined => {
  if (status === "running") {
    return {
      labelId: "session.status.running",
      className:
        "bg-green-500/10 text-green-700 dark:text-green-300 border-green-500/20",
      icon: "running",
    };
  }

  if (status === "paused") {
    return {
      labelId: "session.status.paused",
      className:
        "bg-orange-500/10 text-orange-700 dark:text-orange-300 border-orange-500/20",
      icon: "paused",
    };
  }

  if (status === "awaiting_approval") {
    return {
      labelId: "session.status.awaiting_approval",
      className:
        "bg-yellow-500/10 text-yellow-700 dark:text-yellow-300 border-yellow-500/20",
      icon: "awaiting_approval",
    };
  }

  if (status === "completed") {
    return {
      labelId: "session.status.completed",
      className:
        "bg-slate-500/10 text-slate-700 dark:text-slate-300 border-slate-500/20",
      icon: "completed",
    };
  }

  return undefined;
};
