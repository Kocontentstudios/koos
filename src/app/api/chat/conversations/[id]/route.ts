import { rowsToUiMessages } from "@/lib/ai/chat-messages";
import { getAuthUser } from "@/lib/auth/get-user";
import {
  checkBrandAccess,
  getConversationById,
  getConversationMessages,
  listDesignBriefsForConversation,
} from "@/lib/db/queries";
import { isUuid } from "@/lib/validation/uuid";

/**
 * Load a past conversation's messages for the chat-history switcher.
 * Owned conversations only; 404 otherwise so ids don't leak existence.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { dbUser } = await getAuthUser();
  if (!dbUser) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { id } = await params;
  if (!isUuid(id)) {
    return Response.json({ error: "Conversation not found" }, { status: 404 });
  }
  const conversation = await getConversationById(id);
  if (!conversation) {
    return Response.json({ error: "Conversation not found" }, { status: 404 });
  }
  const access = await checkBrandAccess(
    dbUser.id,
    conversation.brandId,
    "manage_content",
  );
  if (!access.ok) {
    return Response.json(
      { error: "Conversation not found" },
      { status: access.status },
    );
  }

  const [rows, briefs] = await Promise.all([
    getConversationMessages(id),
    listDesignBriefsForConversation(id),
  ]);
  const messages = rowsToUiMessages(
    rows.map((m) => ({
      id: m.id,
      role: m.role as "user" | "assistant",
      content: m.content,
    })),
  );

  return Response.json({
    id: conversation.id,
    title: conversation.title,
    mode: conversation.mode,
    messages,
    briefs,
  });
}
