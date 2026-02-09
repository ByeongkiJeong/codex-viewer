import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { CcvOptionsService } from "./CcvOptionsService";

describe("CcvOptionsService", () => {
  it("returns defaults even before loadCliOptions is called", async () => {
    const port = await Effect.runPromise(
      Effect.gen(function* () {
        const service = yield* CcvOptionsService;
        return yield* service.getCcvOptions("port");
      }).pipe(Effect.provide(CcvOptionsService.Live)),
    );

    expect(Number.isFinite(port)).toBe(true);
  });

  it("reuses loaded options across service instances", async () => {
    const uniquePort = "4319";

    await Effect.runPromise(
      Effect.gen(function* () {
        const service = yield* CcvOptionsService;
        yield* service.loadCliOptions({
          port: uniquePort,
          hostname: "127.0.0.1",
        });
      }).pipe(Effect.provide(CcvOptionsService.Live)),
    );

    const portFromAnotherInstance = await Effect.runPromise(
      Effect.gen(function* () {
        const service = yield* CcvOptionsService;
        return yield* service.getCcvOptions("port");
      }).pipe(Effect.provide(CcvOptionsService.Live)),
    );

    expect(portFromAnotherInstance).toBe(Number(uniquePort));
  });
});
