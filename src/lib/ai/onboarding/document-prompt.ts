import { MAX_TRANSCRIPT_LENGTH } from "./extraction";

/**
 * A document, framed for the extractor that normally reads a chat transcript.
 *
 * The extraction schema and prompt are unchanged — a brand deck answers the
 * same questions a conversation does, and forking a second schema would mean
 * two definitions of a brand drifting apart. The document is presented AS a
 * transcript turn so the existing SYSTEM_PROMPT applies unaltered.
 */

/* The transcript cap is the model's input budget, and the framing below costs
   characters too. Reserved so a long document cannot push the request past the
   cap the extract route validates against. */
const FRAMING_BUDGET = 400;
export const MAX_DOCUMENT_TRANSCRIPT = MAX_TRANSCRIPT_LENGTH - FRAMING_BUDGET;

export function documentTranscript({
  fileName,
  text,
  truncated,
  conversation,
}: {
  fileName: string;
  text: string;
  truncated: boolean;
  /** What the user has already said, if anything. */
  conversation?: string;
}): string {
  /* The document is the newer, more authoritative source — it is the brand's
     own written identity — but the conversation is what the user said in their
     own words just now. Both are given, in that order, and the instruction
     below is what stops the model treating the deck's boilerplate as a
     correction of something the user typed deliberately. */
  const parts: string[] = [];
  if (conversation?.trim()) parts.push(conversation.trim());

  const budget = MAX_DOCUMENT_TRANSCRIPT - (parts[0]?.length ?? 0);
  const body = text.slice(0, Math.max(0, budget));

  parts.push(
    [
      `user: I've uploaded our brand document, "${fileName}". Here is its text.`,
      truncated || body.length < text.length
        ? "(The document was long, so this is the beginning of it.)"
        : null,
      "",
      body,
      "",
      "user: Please take what you can from that document. Only record what it actually says — if it does not cover something, leave that field empty rather than inferring it from the industry.",
    ]
      .filter((line) => line !== null)
      .join("\n"),
  );

  return parts.join("\n\n");
}
