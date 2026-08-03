import { getAuthUser } from "@/lib/auth/get-user";
import {
  checkBrandAccess,
  listDesignGenerationsForBrand,
} from "@/lib/db/queries";
import { serializeGeneration } from "@/lib/design/serialize";
import { isUuid } from "@/lib/validation/uuid";

const MAX_LIMIT = 60;

export async function GET(req: Request) {
  const { dbUser } = await getAuthUser();
  if (!dbUser) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  const url = new URL(req.url);
  const brandId = url.searchParams.get("brandId");
  if (!brandId || !isUuid(brandId)) {
    return Response.json(
      { error: "Missing or invalid brandId" },
      { status: 400 },
    );
  }
  const briefId = url.searchParams.get("briefId") ?? undefined;
  const calendarItemId = url.searchParams.get("calendarItemId") ?? undefined;
  for (const [name, value] of [
    ["briefId", briefId],
    ["calendarItemId", calendarItemId],
  ] as const) {
    if (value != null && !isUuid(value)) {
      return Response.json({ error: `Invalid ${name}` }, { status: 400 });
    }
  }
  const limit = Math.min(
    Number(url.searchParams.get("limit")) || 24,
    MAX_LIMIT,
  );

  const access = await checkBrandAccess(dbUser.id, brandId, "manage_content");
  if (!access.ok) {
    return Response.json({ error: access.error }, { status: access.status });
  }

  const rows = await listDesignGenerationsForBrand(brandId, {
    limit,
    briefId,
    calendarItemId,
  });
  const generations = await Promise.all(rows.map(serializeGeneration));
  return Response.json({ generations });
}
