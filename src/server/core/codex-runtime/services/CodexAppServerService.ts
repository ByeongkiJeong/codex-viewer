import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { Context, Data, Effect, Layer, Ref } from "effect";
import { CcvOptionsService } from "../../platform/services/CcvOptionsService";

export class AppServerUnavailableError extends Data.TaggedError(
  "AppServerUnavailableError",
)<{
  message: string;
}> {}

type AppServerState = {
  process: ChildProcessWithoutNullStreams | null;
  executablePath: string | null;
  listeners: Set<(line: string) => void>;
  buffer: string;
  startError: Error | null;
};

const initialAppServerState = (): AppServerState => ({
  process: null,
  executablePath: null,
  listeners: new Set(),
  buffer: "",
  startError: null,
});

let sharedAppServerStateRef: Ref.Ref<AppServerState> | null = null;

interface CodexAppServerServiceInterface {
  readonly ensureStarted: () => Effect.Effect<void, AppServerUnavailableError>;
  readonly writeMessage: (
    message: string,
  ) => Effect.Effect<void, AppServerUnavailableError>;
  readonly addLineListener: (
    listener: (line: string) => void,
  ) => Effect.Effect<() => void>;
  readonly getExecutablePath: () => Effect.Effect<
    string | null,
    AppServerUnavailableError
  >;
  readonly getStartError: () => Effect.Effect<Error | null>;
}

const splitLines = (chunk: string): { lines: string[]; rest: string } => {
  const pieces = chunk.split("\n");
  const rest = pieces.pop() ?? "";
  return {
    lines: pieces.map((line) => line.trim()).filter((line) => line.length > 0),
    rest,
  };
};

const LayerImpl = Effect.gen(function* () {
  const optionsService = yield* CcvOptionsService;
  const stateRef =
    sharedAppServerStateRef === null
      ? yield* Ref.make<AppServerState>(initialAppServerState())
      : sharedAppServerStateRef;

  if (sharedAppServerStateRef === null) {
    sharedAppServerStateRef = stateRef;
  }

  const emitLine = (line: string) =>
    Effect.gen(function* () {
      const state = yield* Ref.get(stateRef);
      for (const listener of state.listeners) {
        listener(line);
      }
    });

  const attachStdout = (process: ChildProcessWithoutNullStreams) => {
    process.stdout.on("data", (chunk: Buffer | string) => {
      const text = typeof chunk === "string" ? chunk : chunk.toString("utf-8");
      Effect.runFork(
        Effect.gen(function* () {
          const state = yield* Ref.get(stateRef);
          const merged = `${state.buffer}${text}`;
          const { lines, rest } = splitLines(merged);
          yield* Ref.update(stateRef, (prev) => ({
            ...prev,
            buffer: rest,
          }));

          for (const line of lines) {
            yield* emitLine(line);
          }
        }),
      );
    });
  };

  const attachStderr = (process: ChildProcessWithoutNullStreams) => {
    process.stderr.on("data", (chunk: Buffer | string) => {
      const text = typeof chunk === "string" ? chunk : chunk.toString("utf-8");
      console.error(text);
    });
  };

  const attachLifecycle = (process: ChildProcessWithoutNullStreams) => {
    process.on("error", (error) => {
      Effect.runFork(
        Ref.update(stateRef, (state) => ({
          ...state,
          process: null,
          startError: error instanceof Error ? error : new Error(String(error)),
        })),
      );
    });

    process.on("exit", (code, signal) => {
      const reason = `codex app-server exited (code=${code ?? "null"}, signal=${
        signal ?? "null"
      })`;

      Effect.runFork(
        Ref.update(stateRef, (state) => ({
          ...state,
          process: null,
          startError: new Error(reason),
        })),
      );
    });
  };

  const ensureStarted = (): Effect.Effect<void, AppServerUnavailableError> =>
    Effect.gen(function* () {
      const current = yield* Ref.get(stateRef);
      if (current.process !== null) {
        return;
      }

      const executable =
        (yield* optionsService.getCcvOptions("executable")) ?? "codex";

      const childProcess = yield* Effect.try({
        try: () =>
          spawn(executable, ["app-server"], {
            stdio: ["pipe", "pipe", "pipe"],
          }),
        catch: (error) =>
          new AppServerUnavailableError({
            message: `Failed to start codex app-server: ${String(error)}`,
          }),
      });

      attachStdout(childProcess);
      attachStderr(childProcess);
      attachLifecycle(childProcess);

      yield* Ref.update(stateRef, (state) => ({
        ...state,
        process: childProcess,
        executablePath: executable,
        buffer: "",
        startError: null,
      }));
    });

  const assertProcess = () =>
    Effect.gen(function* () {
      const state = yield* Ref.get(stateRef);
      if (state.process !== null) {
        return state.process;
      }

      if (state.startError !== null) {
        return yield* Effect.fail(
          new AppServerUnavailableError({
            message: state.startError.message,
          }),
        );
      }

      return yield* Effect.fail(
        new AppServerUnavailableError({
          message: "codex app-server is not running",
        }),
      );
    });

  const writeMessage = (
    message: string,
  ): Effect.Effect<void, AppServerUnavailableError> =>
    Effect.gen(function* () {
      yield* ensureStarted();
      const process = yield* assertProcess();
      yield* Effect.try({
        try: () => {
          process.stdin.write(`${message}\n`);
        },
        catch: (error) =>
          new AppServerUnavailableError({
            message: `Failed to write to codex app-server: ${String(error)}`,
          }),
      });
    });

  const addLineListener = (
    listener: (line: string) => void,
  ): Effect.Effect<() => void> =>
    Effect.gen(function* () {
      yield* Ref.update(stateRef, (state) => ({
        ...state,
        listeners: new Set([...state.listeners, listener]),
      }));

      return () =>
        Effect.runFork(
          Ref.update(stateRef, (state) => {
            const next = new Set(state.listeners);
            next.delete(listener);
            return {
              ...state,
              listeners: next,
            };
          }),
        );
    });

  const getExecutablePath = (): Effect.Effect<
    string | null,
    AppServerUnavailableError
  > =>
    Effect.gen(function* () {
      yield* ensureStarted();
      const state = yield* Ref.get(stateRef);
      return state.executablePath;
    });

  const getStartError = (): Effect.Effect<Error | null> =>
    Effect.gen(function* () {
      const state = yield* Ref.get(stateRef);
      return state.startError;
    });

  return {
    ensureStarted,
    writeMessage,
    addLineListener,
    getExecutablePath,
    getStartError,
  } satisfies CodexAppServerServiceInterface;
});

export type ICodexAppServerService = CodexAppServerServiceInterface;
export class CodexAppServerService extends Context.Tag("CodexAppServerService")<
  CodexAppServerService,
  ICodexAppServerService
>() {
  static Live = Layer.effect(this, LayerImpl);
}
