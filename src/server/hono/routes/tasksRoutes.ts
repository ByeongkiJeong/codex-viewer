import { zValidator } from "@hono/zod-validator";
import { Effect } from "effect";
import { Hono } from "hono";
import { z } from "zod";
import { TasksController } from "../../core/tasks/presentation/TasksController";
import { TaskCreateSchema, TaskUpdateSchema } from "../../core/tasks/schema";
import { effectToResponse } from "../../lib/effect/toEffectResponse";
import type { HonoContext } from "../app";
import { getHonoRuntime } from "../runtime";

const tasksRoutes = Effect.gen(function* () {
  const tasksController = yield* TasksController;
  const runtime = yield* getHonoRuntime;

  return new Hono<HonoContext>()
    .get(
      "/",
      zValidator(
        "query",
        z.object({
          projectId: z.string(),
          sessionId: z.string().optional(),
        }),
      ),
      async (c) => {
        const { projectId, sessionId } = c.req.valid("query");
        const status: 200 = 200;

        const response = await effectToResponse(
          c,
          tasksController.listTasks(projectId, sessionId).pipe(
            Effect.map((tasks) => ({
              status,
              response: tasks,
            })),
            Effect.provide(runtime),
          ),
        );
        return response;
      },
    )
    .post(
      "/",
      zValidator(
        "query",
        z.object({
          projectId: z.string(),
          sessionId: z.string().optional(),
        }),
      ),
      zValidator("json", TaskCreateSchema),
      async (c) => {
        const { projectId, sessionId } = c.req.valid("query");
        const body = c.req.valid("json");
        const status: 200 = 200;

        const response = await effectToResponse(
          c,
          tasksController.createTask(projectId, body, sessionId).pipe(
            Effect.map((task) => ({
              status,
              response: task,
            })),
            Effect.provide(runtime),
          ),
        );
        return response;
      },
    )
    .patch(
      "/:taskId",
      zValidator(
        "query",
        z.object({
          projectId: z.string(),
          sessionId: z.string().optional(),
        }),
      ),
      zValidator("json", TaskUpdateSchema.omit({ taskId: true })),
      async (c) => {
        const { taskId } = c.req.param();
        const { projectId, sessionId } = c.req.valid("query");
        const body = c.req.valid("json");
        const status: 200 = 200;

        const response = await effectToResponse(
          c,
          tasksController
            .updateTask(projectId, { ...body, taskId }, sessionId)
            .pipe(
              Effect.map((task) => ({
                status,
                response: task,
              })),
              Effect.provide(runtime),
            ),
        );
        return response;
      },
    );
});

export { tasksRoutes };
