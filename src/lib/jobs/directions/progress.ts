import { JOB_STAGES, type JobStage } from "@/lib/generation/poll-job";
import type { ReportProgress } from "../run-generation";

/**
 * Stage reports for the directions job, which never move backwards.
 *
 * The two directions render concurrently, so one can reach its checks while
 * the other is still rendering. The UI shows four steps in order; a report
 * that stepped back from "checks" to "render" would make a finished step
 * light up again. A late report from an earlier stage is dropped, and within
 * a stage `done` only grows.
 */
export function createStageReporter(
  report: ReportProgress,
  total: number,
): (stage: JobStage, done: number, label: string) => void {
  let current = -1;
  let doneSoFar = 0;
  return (stage, done, label) => {
    const index = JOB_STAGES.indexOf(stage);
    if (index < current) return;
    if (index === current && done < doneSoFar) return;
    if (index > current) doneSoFar = 0;
    current = index;
    doneSoFar = done;
    report({ stage, done, total, label });
  };
}
