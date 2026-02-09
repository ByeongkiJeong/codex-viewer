import { zValidator } from "@hono/zod-validator";
import { Effect } from "effect";
import { Hono } from "hono";
import { SchedulerController } from "../../core/scheduler/presentation/SchedulerController";
import {
  newSchedulerJobSchema,
  updateSchedulerJobSchema,
} from "../../core/scheduler/schema";
import type { HonoContext } from "../app";
import { getHonoRuntime } from "../runtime";

const schedulerRoutes = Effect.gen(function* () {
  const schedulerController = yield* SchedulerController;
  const runtime = yield* getHonoRuntime;

  return new Hono<HonoContext>()
    .get("/jobs", async (c) => {
      const result = await Effect.runPromise(
        schedulerController.getJobs().pipe(Effect.provide(runtime)),
      );
      return c.json(result.response, result.status);
    })
    .post("/jobs", zValidator("json", newSchedulerJobSchema), async (c) => {
      const result = await Effect.runPromise(
        schedulerController
          .addJob({
            job: c.req.valid("json"),
          })
          .pipe(Effect.provide(runtime)),
      );
      return c.json(result.response, result.status);
    })
    .patch(
      "/jobs/:id",
      zValidator("json", updateSchedulerJobSchema),
      async (c) => {
        const result = await Effect.runPromise(
          schedulerController
            .updateJob({
              id: c.req.param("id"),
              job: c.req.valid("json"),
            })
            .pipe(Effect.provide(runtime)),
        );
        return c.json(result.response, result.status);
      },
    )
    .delete("/jobs/:id", async (c) => {
      const result = await Effect.runPromise(
        schedulerController
          .deleteJob({
            id: c.req.param("id"),
          })
          .pipe(Effect.provide(runtime)),
      );
      return c.json(result.response, result.status);
    });
});

export { schedulerRoutes };
