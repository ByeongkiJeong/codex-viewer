import type { PermissionRequest } from "../../../../types/permissions";
import type { PublicSessionProcess } from "../../../../types/session-process";

export type InternalEventDeclaration = {
  // biome-ignore lint/complexity/noBannedTypes: correct type
  heartbeat: {};

  sessionListChanged: {
    projectId: string;
  };

  sessionChanged: {
    projectId: string;
    sessionId: string;
  };

  sessionProcessChanged: {
    processes: PublicSessionProcess[];
    changed: PublicSessionProcess;
  };

  permissionRequested: {
    permissionRequest: PermissionRequest;
  };

  virtualConversationUpdated: {
    projectId: string;
    sessionId: string;
  };
};
