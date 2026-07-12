type ConversationRow = { id: string; userId: string; brandId: string };

export type ConversationMode = "strategy" | "design";

export interface EnsureConversationDeps {
  getConversationById: (id: string) => Promise<ConversationRow | null>;
  createConversation: (data: {
    id: string;
    brandId: string;
    userId: string;
    title: string | null;
    mode: ConversationMode;
  }) => Promise<unknown>;
}

export interface EnsureConversationArgs {
  conversationId: string;
  brandId: string;
  userId: string;
  /** Title for a newly-created conversation (ignored when it already exists). */
  title?: string | null;
  /** Chat mode stored on a newly-created conversation. */
  mode?: ConversationMode;
}

/**
 * Ensure a chat conversation exists for the given brand. Creates it (owned
 * by userId+brandId) when absent; when present, verifies it belongs to the
 * same brand. Chat conversations are workspace content, so any teammate with
 * access to the brand may resume one — the caller is responsible for
 * checking that access (see `checkBrandAccess`) before calling this helper.
 */
export async function ensureConversation(
  deps: EnsureConversationDeps,
  { conversationId, brandId, userId, title, mode }: EnsureConversationArgs,
): Promise<
  { ok: true; created: boolean } | { ok: false; status: number; error: string }
> {
  const existing = await deps.getConversationById(conversationId);
  if (!existing) {
    await deps.createConversation({
      id: conversationId,
      brandId,
      userId,
      title: title ?? null,
      mode: mode ?? "strategy",
    });
    return { ok: true, created: true };
  }
  if (existing.brandId !== brandId) {
    return { ok: false, status: 403, error: "Forbidden" };
  }
  return { ok: true, created: false };
}

/** Derive a short conversation title from the opening user message. */
export function conversationTitleFrom(text: string): string | null {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (!cleaned) return null;
  return cleaned.length > 60 ? `${cleaned.slice(0, 57)}…` : cleaned;
}
