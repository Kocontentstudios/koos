import { MAX_CONVERSATION_TITLE } from "@/app/(dashboard)/strategy/conversation-title";
import { rowsToUiMessages } from "@/lib/ai/chat-messages";
import { getAuthUser } from "@/lib/auth/get-user";
import {
  checkBrandAccess,
  getConversationById,
  getConversationMessages,
  getLatestStrategyForConversation,
  listDesignBriefsForConversation,
  renameConversation,
} from "@/lib/db/queries";
import { toCampaignCard } from "@/lib/strategy/campaign-card";
import { isUuid } from "@/lib/validation/uuid";

export { MAX_CONVERSATION_TITLE };

type Authorized =
  | {
      ok: true;
      conversation: NonNullable<
        Awaited<ReturnType<typeof getConversationById>>
      >;
    }
  | { ok: false; response: Response };

/**
 * Both handlers authorize identically: unknown id, missing row and no brand
 * access all answer 404-shaped so conversation ids never leak existence.
 */
async function authorizeConversation(id: string): Promise<Authorized> {
  const notFound = {
    ok: false as const,
    response: Response.json(
      { error: "Conversation not found" },
      { status: 404 },
    ),
  };

  const { dbUser } = await getAuthUser();
  if (!dbUser) {
    return {
      ok: false,
      response: Response.json({ error: "Not authenticated" }, { status: 401 }),
    };
  }
  if (!isUuid(id)) return notFound;

  const conversation = await getConversationById(id);
  if (!conversation) return notFound;

  const access = await checkBrandAccess(
    dbUser.id,
    conversation.brandId,
    "manage_content",
  );
  if (!access.ok) {
    return {
      ok: false,
      response: Response.json(
        { error: "Conversation not found" },
        { status: access.status },
      ),
    };
  }
  return { ok: true, conversation };
}

/**
 * Load a past conversation for the chat-history switcher: its messages, its
 * design briefs, and the campaign strategy it produced. The strategy comes
 * back as a card because chat_messages stores flat text — a card rendered as
 * a message part would not survive the reload.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const auth = await authorizeConversation(id);
  if (!auth.ok) return auth.response;
  const { conversation } = auth;

  const [rows, briefs, strategyRow] = await Promise.all([
    getConversationMessages(id),
    listDesignBriefsForConversation(id),
    getLatestStrategyForConversation(id),
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
    titleCustom: conversation.titleCustom,
    mode: conversation.mode,
    messages,
    briefs,
    strategy: strategyRow ? toCampaignCard(strategyRow) : null,
  });
}

/** Rename a chat. A user-typed title locks out every automatic title write. */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const auth = await authorizeConversation(id);
  if (!auth.ok) return auth.response;

  let body: { title?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }
  if (typeof body.title !== "string") {
    return Response.json({ error: "Title is required" }, { status: 400 });
  }
  const title = body.title.trim();
  if (!title) {
    return Response.json({ error: "Title cannot be empty" }, { status: 400 });
  }
  if (title.length > MAX_CONVERSATION_TITLE) {
    return Response.json(
      { error: `Title must be ${MAX_CONVERSATION_TITLE} characters or fewer` },
      { status: 400 },
    );
  }

  const updated = await renameConversation(id, title);
  if (!updated) {
    return Response.json({ error: "Conversation not found" }, { status: 404 });
  }
  return Response.json({ id: updated.id, title: updated.title });
}
