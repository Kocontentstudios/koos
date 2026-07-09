import { z } from "zod";
import { describeMailError, sendMail } from "@/lib/email";
import { contactFormEmail } from "@/lib/email-templates";
import { isValidEmail } from "@/lib/validation/email";

const requestSchema = z.object({
  name: z.string().trim().min(1).max(200),
  email: z.string().trim().max(320),
  message: z.string().trim().min(1).max(5000),
  company: z.string().max(200).optional(), // honeypot — humans never see it
});

function contactInbox(): string {
  return (process.env.CONTACT_EMAIL || "hello@kocontentstudios.com").trim();
}

export async function POST(req: Request) {
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }

  const parsed = requestSchema.safeParse(json);
  if (!parsed.success || !isValidEmail(parsed.data.email)) {
    return Response.json(
      { error: "Please fill in a valid name, email, and message." },
      { status: 400 },
    );
  }
  const { name, email, message, company } = parsed.data;

  // Honeypot tripped: report success but send nothing.
  if (company) {
    return Response.json({ ok: true });
  }

  try {
    const { subject, html } = contactFormEmail({ name, email, message });
    await sendMail({ to: contactInbox(), subject, html, replyTo: email });
  } catch (err) {
    console.error("contact form email failed:", describeMailError(err));
    return Response.json(
      {
        error:
          "We couldn't send your message right now. Please try again in a few minutes, " +
          "or email us directly at hello@kocontentstudios.com.",
      },
      { status: 500 },
    );
  }

  return Response.json({ ok: true });
}
