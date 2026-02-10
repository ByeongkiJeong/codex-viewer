import { Path } from "@effect/platform";
import { Context, Effect, Layer, Ref } from "effect";
import MiniSearch from "minisearch";
import type { ParsedCodexLine } from "../../../../lib/codex-conversation-schema/parseCodexJsonl";
import type { InferEffect } from "../../../lib/effect/types";
import { encodeProjectId } from "../../project/functions/id";
import { SessionIndexService } from "../../session/infrastructure/SessionIndexService";

export type SearchResult = {
  projectId: string;
  projectName: string;
  sessionId: string;
  conversationIndex: number;
  type: "user" | "assistant";
  snippet: string;
  timestamp: string;
  score: number;
};

type SearchDocument = {
  id: string;
  projectId: string;
  projectName: string;
  sessionId: string;
  conversationIndex: number;
  type: "user" | "assistant";
  text: string;
  timestamp: string;
};

type IndexCache = {
  index: MiniSearch<SearchDocument>;
  documents: Map<string, SearchDocument>;
  builtAt: number;
};

const INDEX_TTL_MS = 60_000;
const MAX_TEXT_LENGTH = 2000;

const createMiniSearchIndex = () =>
  new MiniSearch<SearchDocument>({
    fields: ["text"],
    storeFields: ["id"],
    searchOptions: {
      fuzzy: 0.2,
      prefix: true,
      boost: { text: 1 },
    },
  });

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const getStringField = (value: unknown, key: string): string | null => {
  if (!isRecord(value)) return null;
  const field = value[key];
  return typeof field === "string" ? field : null;
};

const extractContentText = (content: unknown): string[] => {
  if (!Array.isArray(content)) {
    return [];
  }

  const result: string[] = [];
  for (const item of content) {
    if (typeof item === "string") {
      if (item.trim().length > 0) {
        result.push(item.trim());
      }
      continue;
    }

    if (!isRecord(item)) {
      continue;
    }

    const text = getStringField(item, "text");
    if (text !== null && text.trim().length > 0) {
      result.push(text.trim());
      continue;
    }

    const input = getStringField(item, "input");
    if (input !== null && input.trim().length > 0) {
      result.push(input.trim());
    }
  }

  return result;
};

const extractSearchableLine = (
  line: ParsedCodexLine,
): { text: string; type: "user" | "assistant" } | null => {
  if (line.type !== "response_item") {
    return null;
  }

  const payload = line.payload;
  const payloadType = getStringField(payload, "type");
  if (payloadType === null) {
    return null;
  }

  if (payloadType === "message") {
    const role = getStringField(payload, "role");
    const content = extractContentText(
      isRecord(payload) ? payload.content : undefined,
    );
    const text = content.join("\n").trim();
    if (text.length === 0) {
      return null;
    }

    return {
      text,
      type: role === "user" ? "user" : "assistant",
    };
  }

  if (payloadType === "reasoning") {
    const summary = getStringField(payload, "summary");
    const text = summary ?? extractContentText(payload).join("\n");
    if (text.trim().length === 0) {
      return null;
    }
    return {
      text,
      type: "assistant",
    };
  }

  if (
    payloadType === "function_call" ||
    payloadType === "custom_tool_call" ||
    payloadType === "function_call_output" ||
    payloadType === "custom_tool_call_output"
  ) {
    const name =
      getStringField(payload, "name") ??
      getStringField(payload, "call_id") ??
      payloadType;
    const argumentsText =
      getStringField(payload, "arguments") ??
      getStringField(payload, "output") ??
      "";
    const text = `${name} ${argumentsText}`.trim();
    if (text.length === 0) {
      return null;
    }

    return {
      text,
      type: "assistant",
    };
  }

  return null;
};

const LayerImpl = Effect.gen(function* () {
  const path = yield* Path.Path;
  const sessionIndexService = yield* SessionIndexService;
  const indexCacheRef = yield* Ref.make<IndexCache | null>(null);

  const buildIndex = () =>
    Effect.gen(function* () {
      const sessions =
        yield* sessionIndexService.getSessionIndicesWithParsedLines();
      const miniSearch = createMiniSearchIndex();

      const docs: SearchDocument[] = [];
      for (const session of sessions) {
        const projectId = encodeProjectId(session.cwd);
        const projectName = path.basename(session.cwd);

        for (let i = 0; i < session.parsedLines.length; i++) {
          const line = session.parsedLines[i];
          if (line === undefined) {
            continue;
          }

          const extracted = extractSearchableLine(line);
          if (extracted === null) {
            continue;
          }

          const text =
            extracted.text.length > MAX_TEXT_LENGTH
              ? extracted.text.slice(0, MAX_TEXT_LENGTH)
              : extracted.text;

          docs.push({
            id: `${session.threadId}:${i}`,
            projectId,
            projectName,
            sessionId: session.threadId,
            conversationIndex: i,
            type: extracted.type,
            text,
            timestamp:
              line.type === "x-error"
                ? ""
                : typeof line.timestamp === "string"
                  ? line.timestamp
                  : "",
          });
        }
      }

      miniSearch.addAll(docs);

      const docMap = new Map<string, SearchDocument>();
      for (const doc of docs) {
        docMap.set(doc.id, doc);
      }

      return {
        index: miniSearch,
        documents: docMap,
      };
    });

  const getIndex = () =>
    Effect.gen(function* () {
      const cached = yield* Ref.get(indexCacheRef);
      const now = Date.now();
      if (cached !== null && now - cached.builtAt < INDEX_TTL_MS) {
        return cached;
      }

      const built = yield* buildIndex();
      const next: IndexCache = {
        index: built.index,
        documents: built.documents,
        builtAt: now,
      };
      yield* Ref.set(indexCacheRef, next);
      return next;
    });

  const search = (query: string, limit = 20, projectId?: string) =>
    Effect.gen(function* () {
      if (query.trim().length === 0) {
        return { results: [] as SearchResult[] };
      }

      const { index, documents } = yield* getIndex();
      const searchResults = index.search(query).slice(0, limit * 2);
      const results: SearchResult[] = [];

      for (const result of searchResults) {
        if (results.length >= limit) {
          break;
        }

        const doc = documents.get(String(result.id));
        if (doc === undefined) {
          continue;
        }

        if (projectId !== undefined && doc.projectId !== projectId) {
          continue;
        }

        const queryLower = query.toLowerCase();
        const textLower = doc.text.toLowerCase();
        const matchIndex = textLower.indexOf(queryLower);
        const start = matchIndex === -1 ? 0 : Math.max(0, matchIndex - 50);
        const end = Math.min(doc.text.length, start + 150);
        const snippet =
          (start > 0 ? "..." : "") +
          doc.text.slice(start, end) +
          (end < doc.text.length ? "..." : "");

        results.push({
          projectId: doc.projectId,
          projectName: doc.projectName,
          sessionId: doc.sessionId,
          conversationIndex: doc.conversationIndex,
          type: doc.type,
          snippet,
          timestamp: doc.timestamp,
          score: result.score,
        });
      }

      return {
        results,
      };
    });

  const invalidateIndex = () => Ref.set(indexCacheRef, null);

  return {
    search,
    invalidateIndex,
  };
});

export type ISearchService = InferEffect<typeof LayerImpl>;
export class SearchService extends Context.Tag("SearchService")<
  SearchService,
  ISearchService
>() {
  static Live = Layer.effect(this, LayerImpl);
}
