export type Flag =
  | {
      name: "app-server";
      enabled: boolean;
    }
  | {
      name: "tool-approval";
      enabled: boolean;
    }
  | {
      name: "session-processes";
      enabled: boolean;
    }
  | {
      name: "mcp-server-status";
      enabled: boolean;
    }
  | {
      name: "tasks";
      enabled: boolean;
    };

export type FlagName = Flag["name"];
