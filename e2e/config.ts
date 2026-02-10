import { encodeProjectId } from "../src/server/core/project/functions/id";

export const sampleProjectPath = "/path/to/Demo";

export const projectIds = {
  sampleProject: encodeProjectId(sampleProjectPath),
} as const;
