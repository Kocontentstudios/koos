type ConversationRow = { id: string; userId: string; brandId: string };

export interface EnsureConversationDeps {
  getConversationById: (id: string) => Promise<ConversationRow | null>;
  createConversation: (data: {
    id: string;
    brandId: string;
    userId: string;
  }) => Promise<unknown>;
}

export interface EnsureConversationArgs {
  conversationId: string;
  brandId: string;
  userId: string;
}

/**
 * Ensure a chat conversation exists and belongs to the caller. Creates it
 * (owned by userId+brandId) when absent; when present, verifies ownership.
 */
export async function ensureConversation(
  deps: EnsureConversationDeps,
  { conversationId, brandId, userId }: EnsureConversationArgs,
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const existing = await deps.getConversationById(conversationId);
  if (!existing) {
    await deps.createConversation({ id: conversationId, brandId, userId });
    return { ok: true };
  }
  if (existing.userId !== userId) {
    return { ok: false, status: 403, error: "Forbidden" };
  }
  return { ok: true };
}
