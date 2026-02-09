import { FileSystem, Path } from "@effect/platform";
import type { PlatformError } from "@effect/platform/Error";
import { Effect } from "effect";

export type CommandInfo = {
  name: string;
  description: string | null;
  argumentHint: string | null;
};

export const parseCommandFrontmatter = (
  content: string,
): { description: string | null; argumentHint: string | null } => {
  const frontmatterMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!frontmatterMatch?.[1]) {
    return { description: null, argumentHint: null };
  }

  const frontmatter = frontmatterMatch[1];

  const descriptionMatch = frontmatter.match(
    /^description:\s*['"]?([^'"\n]+)['"]?\s*$/m,
  );
  const description = descriptionMatch?.[1]?.trim() ?? null;

  const argumentHintMatch = frontmatter.match(
    /^argument-hint:\s*['"]?([^'"\n]+)['"]?\s*$/m,
  );
  const argumentHint = argumentHintMatch?.[1]?.trim() ?? null;

  return { description, argumentHint };
};

export const pathToCommandName = (
  filePath: string,
  baseDir: string,
): string => {
  const normalizedBaseDir = baseDir.endsWith("/")
    ? baseDir.slice(0, -1)
    : baseDir;

  const relativePath = filePath.startsWith(normalizedBaseDir)
    ? filePath.slice(normalizedBaseDir.length + 1)
    : filePath;

  return relativePath.replace(/\.md$/, "").replace(/\//g, ":");
};

export const scanCommandFilesWithMetadata = (
  dirPath: string,
): Effect.Effect<CommandInfo[], never, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;

    const scanDirectory = (
      currentPath: string,
    ): Effect.Effect<
      CommandInfo[],
      PlatformError,
      FileSystem.FileSystem | Path.Path
    > =>
      Effect.gen(function* () {
        if (!(yield* fs.exists(currentPath))) {
          return [];
        }

        const items = yield* fs.readDirectory(currentPath);
        const nested = yield* Effect.forEach(
          items,
          (item) =>
            Effect.gen(function* () {
              if (item.startsWith(".")) {
                return [];
              }

              const itemPath = path.join(currentPath, item);
              const info = yield* fs.stat(itemPath);

              if (info.type === "Directory") {
                return yield* scanDirectory(itemPath);
              }

              if (info.type === "File" && item.endsWith(".md")) {
                const content = yield* fs.readFileString(itemPath);
                const { description, argumentHint } =
                  parseCommandFrontmatter(content);
                const name = pathToCommandName(itemPath, dirPath);
                const commandInfo: CommandInfo = {
                  name,
                  description,
                  argumentHint,
                };
                return [commandInfo];
              }

              return [];
            }),
          { concurrency: "unbounded" },
        );

        return nested.flat();
      });

    return yield* scanDirectory(dirPath).pipe(
      Effect.match({
        onSuccess: (items) => items,
        onFailure: () => [],
      }),
    );
  });

export const scanSkillFilesWithMetadata = (
  dirPath: string,
): Effect.Effect<CommandInfo[], never, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;

    const scanDirectory = (
      currentPath: string,
      relativePath: string,
    ): Effect.Effect<
      CommandInfo[],
      PlatformError,
      FileSystem.FileSystem | Path.Path
    > =>
      Effect.gen(function* () {
        if (!(yield* fs.exists(currentPath))) {
          return [];
        }

        const skillFilePath = path.join(currentPath, "SKILL.md");
        const hasSkill = yield* fs.exists(skillFilePath);

        const currentSkills: CommandInfo[] = [];
        if (hasSkill) {
          const skillName = relativePath.replace(/\//g, ":");
          if (skillName.length > 0) {
            const content = yield* fs.readFileString(skillFilePath);
            const { description, argumentHint } =
              parseCommandFrontmatter(content);
            currentSkills.push({
              name: skillName,
              description,
              argumentHint,
            });
          }
        }

        const items = yield* fs.readDirectory(currentPath);
        const nested = yield* Effect.forEach(
          items,
          (item) =>
            Effect.gen(function* () {
              if (item.startsWith(".")) {
                return [];
              }

              const itemPath = path.join(currentPath, item);
              const info = yield* fs.stat(itemPath);

              if (info.type !== "Directory") {
                return [];
              }

              const nextRelativePath =
                relativePath.length > 0 ? `${relativePath}/${item}` : item;

              return yield* scanDirectory(itemPath, nextRelativePath);
            }),
          { concurrency: "unbounded" },
        );

        return [...currentSkills, ...nested.flat()];
      });

    return yield* scanDirectory(dirPath, "").pipe(
      Effect.match({
        onSuccess: (items) => items,
        onFailure: () => [],
      }),
    );
  });
