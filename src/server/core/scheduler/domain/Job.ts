import { Effect } from "effect";
import type { ICodexLifeCycleService } from "../../codex-runtime/services/CodexLifeCycleService";
import type { ICodexSessionProcessService } from "../../codex-runtime/services/CodexSessionProcessService";
import type { IProjectRepository } from "../../project/infrastructure/ProjectRepository";
import type { SchedulerJob } from "../schema";

type JobExecutionDependencies = {
  lifeCycleService: ICodexLifeCycleService;
  sessionProcessService: ICodexSessionProcessService;
  projectRepository: IProjectRepository;
};

export const executeJob = (
  job: SchedulerJob,
  dependencies: JobExecutionDependencies,
) =>
  Effect.gen(function* () {
    const { message } = job;
    const { project } = yield* dependencies.projectRepository.getProject(
      message.projectId,
    );

    if (project.meta.projectPath === null) {
      return yield* Effect.fail(
        new Error(`Project path not found for projectId: ${message.projectId}`),
      );
    }

    yield* dependencies.lifeCycleService.ensureStarted();

    yield* dependencies.sessionProcessService.startSessionProcess({
      projectId: message.projectId,
      cwd: project.meta.projectPath,
      baseSession: message.baseSession ?? undefined,
      input: {
        text: message.content,
      },
    });
  });

export const shouldExecuteJob = (job: SchedulerJob, now: Date): boolean => {
  if (!job.enabled) {
    return false;
  }

  if (job.schedule.type === "cron") {
    return true;
  }

  if (job.schedule.type === "reserved") {
    // Reserved jobs are one-time, skip if already executed
    if (job.lastRunStatus !== null) {
      return false;
    }

    const scheduledTime = new Date(job.schedule.reservedExecutionTime);
    return now >= scheduledTime;
  }

  return true;
};

export const calculateReservedDelay = (
  job: SchedulerJob,
  now: Date,
): number => {
  if (job.schedule.type !== "reserved") {
    throw new Error("Job schedule type must be reserved");
  }

  const scheduledTime = new Date(job.schedule.reservedExecutionTime);
  const delay = scheduledTime.getTime() - now.getTime();

  return Math.max(0, delay);
};
