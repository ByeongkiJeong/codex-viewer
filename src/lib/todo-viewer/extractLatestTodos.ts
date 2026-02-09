import type { ParsedCodexLine } from "../codex-conversation-schema/parseCodexJsonl";

export type TodoItem = {
  readonly content: string;
  readonly status: "pending" | "in_progress" | "completed";
};

const TODO_TOOL_NAMES = new Set(["TodoWrite", "todo_write", "todoWrite"]);

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null;
};

const isTodoStatus = (status: unknown): status is TodoItem["status"] => {
  return (
    status === "pending" || status === "in_progress" || status === "completed"
  );
};

const parseTodoList = (value: unknown): TodoItem[] | null => {
  if (!Array.isArray(value)) {
    return null;
  }

  const todos: TodoItem[] = [];

  for (const item of value) {
    if (!isRecord(item)) {
      continue;
    }

    const content = item.content;
    const status = item.status;

    if (typeof content !== "string" || !isTodoStatus(status)) {
      continue;
    }

    todos.push({ content, status });
  }

  return todos.length > 0 ? todos : null;
};

const parseToolArguments = (payload: Record<string, unknown>): unknown => {
  const rawArguments = payload.arguments;
  if (typeof rawArguments === "string") {
    try {
      return JSON.parse(rawArguments);
    } catch {
      return null;
    }
  }

  if (rawArguments !== undefined) {
    return rawArguments;
  }

  return payload.input;
};

export const extractLatestTodos = (
  conversations: readonly ParsedCodexLine[],
): readonly TodoItem[] | null => {
  let latestTodos: readonly TodoItem[] | null = null;

  for (const conversation of conversations) {
    if (conversation.type !== "response_item") {
      continue;
    }

    const payload = conversation.payload;
    if (!isRecord(payload)) {
      continue;
    }

    const payloadType = payload.type;
    if (payloadType !== "function_call" && payloadType !== "custom_tool_call") {
      continue;
    }

    const toolName =
      typeof payload.name === "string"
        ? payload.name
        : typeof payload.tool_name === "string"
          ? payload.tool_name
          : null;

    if (toolName === null || !TODO_TOOL_NAMES.has(toolName)) {
      continue;
    }

    const parsedArguments = parseToolArguments(payload);
    if (!isRecord(parsedArguments)) {
      continue;
    }

    const todos = parseTodoList(parsedArguments.todos);
    if (todos !== null) {
      latestTodos = todos;
    }
  }

  return latestTodos;
};
