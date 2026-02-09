import type { z } from "zod";
import type {
  CodexParseErrorLine,
  ParsedCodexLine,
} from "../../lib/codex-conversation-schema/parseCodexJsonl";
import type { projectMetaSchema } from "./project/schema";
import type { sessionMetaSchema } from "./session/schema";

export type Project = {
  id: string;
  projectPath: string;
  lastModifiedAt: Date;
  meta: ProjectMeta;
};

export type ProjectMeta = z.infer<typeof projectMetaSchema>;

export type Session = {
  id: string;
  jsonlFilePath: string;
  lastModifiedAt: Date;
  meta: SessionMeta;
};

export type SessionMeta = z.infer<typeof sessionMetaSchema>;

export type ErrorJsonl = CodexParseErrorLine;

export type ExtendedConversation = ParsedCodexLine;

export type SessionDetail = Session & {
  conversations: ExtendedConversation[];
};
