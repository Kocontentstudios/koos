import { isToolUIPart, type UIMessage } from "ai";
import { type Proposal, ProposalSchema } from "@/lib/ai/tools/proposals";

/**
 * Tool-output parts vary in shape between static (`tool-<name>`) and
 * dynamic (`dynamic-tool`) tool calls; `isToolUIPart` narrows both. Only
 * `output-available` parts carry a result, and only propose_* tools return
 * a `proposal` — validate against ProposalSchema rather than trusting the
 * shape, since a failed/denied tool call has no `proposal` at all.
 */
export function extractProposals(message: UIMessage): Proposal[] {
  if (message.role !== "assistant") return [];

  const proposals: Proposal[] = [];
  for (const part of message.parts) {
    if (!isToolUIPart(part) || part.state !== "output-available") continue;
    const output = part.output;
    if (!output || typeof output !== "object" || !("proposal" in output)) {
      continue;
    }
    const parsed = ProposalSchema.safeParse(
      (output as { proposal: unknown }).proposal,
    );
    if (parsed.success) proposals.push(parsed.data);
  }
  return proposals;
}
