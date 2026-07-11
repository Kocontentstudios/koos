import { getAuthUser } from "@/lib/auth/get-user";
import { updateAppSettings } from "@/lib/db/queries";
import { isValidEmail } from "@/lib/validation/email";

export async function POST(req: Request) {
  const { dbUser } = await getAuthUser();
  if (dbUser?.role !== "admin") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: { designTeamEmail?: string | null };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }

  const designTeamEmail = body.designTeamEmail?.trim() || null;
  if (designTeamEmail && !isValidEmail(designTeamEmail)) {
    return Response.json(
      { error: "Enter a valid email address, or leave it blank." },
      { status: 400 },
    );
  }

  const settings = await updateAppSettings({ designTeamEmail });
  return Response.json({ ok: true, settings });
}
