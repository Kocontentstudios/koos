type ConversationRow = { id: string; userId: string; brandId: string };

export interface EnsureConversationDeps {
  getConversationById: (id: string) => Promise<ConversationRow | null>;
  createConversation: (data: {
    id: string;
    brandId: string;
    userId: string;
    title: string | null;
  }) => Promise<unknown>;
}

export interface EnsureConversationArgs {
  conversationId: string;
  brandId: string;
  userId: string;
  /** Title for a newly-created conversation (ignored when it already exists). */
  title?: string | null;
}

/**
 * Ensure a chat conversation exists and belongs to the caller. Creates it
 * (owned by userId+brandId) when absent; when present, verifies ownership.
 */
export async function ensureConversation(
  deps: EnsureConversationDeps,
  { conversationId, brandId, userId, title }: EnsureConversationArgs,
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const existing = await deps.getConversationById(conversationId);
  if (!existing) {
    await deps.createConversation({
      id: conversationId,
      brandId,
      userId,
      title: title ?? null,
    });
    return { ok: true };
  }
  if (existing.userId !== userId) {
    return { ok: false, status: 403, error: "Forbidden" };
  }
  return { ok: true };
}

/** Derive a short conversation title from the opening user message. */
export function conversationTitleFrom(text: string): string | null {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (!cleaned) return null;
  return cleaned.length > 60 ? `${cleaned.slice(0, 57)}…` : cleaned;
}
