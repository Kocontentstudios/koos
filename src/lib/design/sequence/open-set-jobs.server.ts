import { and, desc, eq, gte, inArray } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { generationJobs } from "@/lib/db/schema";
import {
  MAX_OPEN_SET_JOBS,
  OPEN_SET_JOB_WINDOW_MS,
  type OpenSetJob,
  openSetJobOf,
} from "./open-set-jobs";

/* Scoped to the user as well as the brand: /api/jobs/[id] answers only the
   job's owner, so a teammate's job could be listed but never polled. */
export async function listOpenSetJobs(
  userId: string,
  brandId: string,
  now = Date.now(),
): Promise<OpenSetJob[]> {
  const rows = await db
    .select({
      id: generationJobs.id,
      status: generationJobs.status,
      input: generationJobs.input,
      result: generationJobs.result,
      createdAt: generationJobs.createdAt,
    })
    .from(generationJobs)
    .where(
      and(
        eq(generationJobs.userId, userId),
        eq(generationJobs.brandId, brandId),
        eq(generationJobs.kind, "design_render"),
        inArray(generationJobs.status, ["pending", "running"]),
        gte(generationJobs.createdAt, new Date(now - OPEN_SET_JOB_WINDOW_MS)),
      ),
    )
    .orderBy(desc(generationJobs.createdAt))
    .limit(MAX_OPEN_SET_JOBS);
  return rows.flatMap((row) => openSetJobOf(row) ?? []);
}
