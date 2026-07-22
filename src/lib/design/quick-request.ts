import { z } from "zod";
import { isCarouselType } from "@/lib/design/tickets-ui";
import { isValidEmail } from "@/lib/validation/email";

/** A design request submitted from the quick form, by a user who has not
 * completed (or even started) their brand profile. */
export const quickRequestSchema = z.object({
  businessName: z.string().trim().min(1, "Enter your business name"),
  designType: z.string().trim().min(1, "Choose what you need designed"),
  dimensions: z.string().trim().min(1).optional(),
  slides: z.number().int().min(2).max(10).optional(),
  description: z
    .string()
    .trim()
    .min(20, "Describe what you need in at least 20 characters"),
  referenceImageUrl: z.string().trim().min(1).optional(),
  deliveryEmail: z
    .string()
    .trim()
    .refine(isValidEmail, "Enter a valid email address")
    .optional(),
  dueDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a YYYY-MM-DD date")
    .optional(),
});

export type QuickRequestInput = z.infer<typeof quickRequestSchema>;

/** Render the form submission as a design-request transcript so it can drive
 * the same brief generator the design-mode chat uses, unchanged. */
export function buildQuickRequestConversation(
  input: QuickRequestInput,
): string {
  const lines = [
    `User: I'd like to request a design for ${input.businessName}.`,
    `User: What I need designed: ${input.designType}.`,
  ];
  if (input.dimensions) lines.push(`User: Dimensions: ${input.dimensions}.`);
  if (isCarouselType(input.designType) && input.slides) {
    lines.push(`User: Slides: ${input.slides}.`);
  }
  lines.push(`User: Here are the details: ${input.description}`);
  if (input.referenceImageUrl) {
    lines.push(`User: Reference image: ${input.referenceImageUrl}`);
  }
  if (input.dueDate) lines.push(`User: I need it by ${input.dueDate}.`);
  lines.push(
    "User: I have not filled in my full brand profile yet, so use sensible defaults and do not invent facts about the business.",
  );
  return lines.join("\n");
}

/** The brief submitted when AI polish fails. The whole premise is "one
 * design, no setup" — a model failure must degrade brief quality, never
 * block the request. */
export function fallbackQuickBrief(input: QuickRequestInput): string {
  const sections = [
    `**Request**\n${input.designType} for ${input.businessName}`,
    `**Details**\n${input.description}`,
  ];
  if (input.dimensions) sections.push(`**Dimensions**\n${input.dimensions}`);
  if (isCarouselType(input.designType) && input.slides) {
    sections.push(`**Slides**\n${input.slides}`);
  }
  if (input.referenceImageUrl) {
    sections.push(`**Reference**\n${input.referenceImageUrl}`);
  }
  sections.push(
    "**Note**\nSubmitted without a completed brand profile — confirm brand details with the requester before finalizing.",
  );
  return sections.join("\n\n");
}
