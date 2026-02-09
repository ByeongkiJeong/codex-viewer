export type PermissionRequestKind =
  | "commandExecution"
  | "fileChange"
  | "applyPatch"
  | "execCommand";

export type PermissionRequest = {
  id: string;
  kind: PermissionRequestKind;
  turnId?: string;
  sessionId: string;
  toolName: string;
  toolInput: Record<string, unknown>;
  timestamp: number;
};

export type PermissionResponse = {
  permissionRequestId: string;
  decision: "allow" | "deny";
};
