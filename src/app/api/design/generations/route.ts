import { getAuthUser } from "@/lib/auth/get-user";
import {
  checkBrandAccess,
  listDesignGenerationsForBrand,
} from "@/lib/db/queries";
import { serializeGeneration } from "@/lib/design/serialize";
import { isUuid } from "@/lib/validation/uuid";

const MAX_LIMIT = 60;

/* A generation run asks for its own rows by id. Bounded so the parameter
   cannot be used to assemble an arbitrarily long IN list. */
const MAX_IDS = 20;

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
  /* Addressing rows BY ID is what a just-finished run needs: asking for "the
     newest N for this brand" and filtering the page down to its own ids
     returns nothing whenever anything newer exists, which is how a successful
     generation rendered "No designs yet" (KOOS-BUG-015). */
  const idsParam = url.searchParams.get("ids");
  const ids = idsParam
    ? idsParam
        .split(",")
        .map((v) => v.trim())
        .filter(Boolean)
    : undefined;
  if (ids) {
    if (ids.length === 0 || ids.length > MAX_IDS) {
      return Response.json({ error: "Invalid ids" }, { status: 400 });
    }
    if (!ids.every(isUuid)) {
      return Response.json({ error: "Invalid ids" }, { status: 400 });
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
    // Asking by id means asking for exactly those rows, so the limit must not
    // cut the answer short.
    limit: ids ? ids.length : limit,
    briefId,
    calendarItemId,
    ids,
  });
  const generations = await Promise.all(rows.map(serializeGeneration));
  return Response.json({ generations });
}
