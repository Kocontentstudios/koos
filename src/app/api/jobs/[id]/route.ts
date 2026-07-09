import { getAuthUser } from "@/lib/auth/get-user";
import { getGenerationJobById } from "@/lib/db/queries";
import { isUuid } from "@/lib/validation/uuid";

/**
 * Poll a generation job's status. Owned jobs only; 404 for anything else so
 * job ids don't leak existence. The `result` payload is included once the
 * job succeeds and matches what the old synchronous route returned.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { dbUser } = await getAuthUser();
  if (!dbUser) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { id } = await params;
  if (!isUuid(id)) {
    return Response.json({ error: "Job not found" }, { status: 404 });
  }
  const job = await getGenerationJobById(id);
  if (!job || job.userId !== dbUser.id) {
    return Response.json({ error: "Job not found" }, { status: 404 });
  }

  return Response.json({
    status: job.status,
    kind: job.kind,
    result: job.status === "succeeded" ? job.result : null,
    error: job.status === "failed" ? job.error : null,
  });
}
