import {
  convertToModelMessages,
  generateText,
  streamText,
  type UIMessage,
} from "ai";
import { flattenMessageText } from "@/lib/ai/chat-messages";
import type { ChatBrandContext } from "@/lib/ai/prompts/chat";
import { buildChatPrompt } from "@/lib/ai/prompts/chat";
import { buildDesignRequestChatPrompt } from "@/lib/ai/prompts/design-request";
import { getModel } from "@/lib/ai/provider";
import { getAuthUser } from "@/lib/auth/get-user";
import {
  createConversation,
  createMessage,
  getBrandById,
  getConversationById,
  touchConversation,
  updateConversationTitle,
} from "@/lib/db/queries";
import { checkRateLimit, tooManyRequests } from "@/lib/rate-limit";
import { isUuid } from "@/lib/validation/uuid";
import {
  conversationTitleFrom,
  ensureConversation,
} from "./ensure-conversation";
import { buildTitlePrompt, cleanGeneratedTitle } from "./title";

export async function POST(req: Request) {
  // Authenticated users only — this endpoint spends AI tokens.
  const { dbUser } = await getAuthUser();
  if (!dbUser) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  const verdict = await checkRateLimit({
    key: `chat:${dbUser.id}`,
    limit: 30,
    windowSeconds: 300,
  });
  if (!verdict.ok) return tooManyRequests(verdict);

  const { messages, brandContext, brandId, conversationId, mode } =
    (await req.json()) as {
      messages: UIMessage[];
      brandContext: ChatBrandContext;
      brandId: string;
      conversationId: string;
      mode?: string;
    };
  const chatMode = mode === "design" ? "design" : "strategy";

  if (!isUuid(brandId) || !isUuid(conversationId)) {
    return Response.json(
      { error: "Invalid brandId or conversationId" },
      { status: 400 },
    );
  }

  // Verify the brand belongs to the caller before persisting under it.
  const brand = await getBrandById(brandId);
  if (!brand || brand.userId !== dbUser.id) {
    return Response.json({ error: "Brand not found" }, { status: 404 });
  }

  // The just-sent user message is the last item; it doubles as the title
  // for a conversation created on this first turn.
  const firstUserMessage = messages.findLast((m) => m.role === "user");
  const ensured = await ensureConversation(
    { getConversationById, createConversation },
    {
      conversationId,
      brandId,
      userId: dbUser.id,
      title: firstUserMessage
        ? conversationTitleFrom(flattenMessageText(firstUserMessage))
        : null,
      mode: chatMode,
    },
  );
  if (!ensured.ok) {
    return Response.json({ error: ensured.error }, { status: ensured.status });
  }

  const systemPrompt =
    chatMode === "design"
      ? buildDesignRequestChatPrompt(brandContext)
      : buildChatPrompt(brandContext);
  const modelMessages = await convertToModelMessages(messages);

  // The just-sent user message is the last item; capture it for persistence.
  const lastUserMessage = messages[messages.length - 1];

  const result = streamText({
    model: getModel("chat"),
    system: systemPrompt,
    messages: modelMessages,
    // Persist the completed turn once, after the assistant reply is final, so a
    // stream that errors mid-flight never leaves an orphaned user row.
    onFinish: async ({ text }) => {
      try {
        if (lastUserMessage?.role === "user") {
          await createMessage({
            conversationId,
            role: "user",
            content: flattenMessageText(lastUserMessage),
          });
        }
        await createMessage({
          conversationId,
          role: "assistant",
          content: text,
        });
        await touchConversation(conversationId);
      } catch (err) {
        // Persistence failure must not break the user's chat experience.
        console.error("chat persistence failed", err);
      }

      // First turn of a new conversation: replace the truncated first-message
      // title with a short AI-generated one. Best-effort — a failure here must
      // never affect the chat itself.
      if (ensured.created && firstUserMessage) {
        try {
          const { text: rawTitle } = await generateText({
            model: getModel("chat"),
            prompt: buildTitlePrompt(
              flattenMessageText(firstUserMessage),
              text,
            ),
          });
          const title = cleanGeneratedTitle(rawTitle);
          if (title) await updateConversationTitle(conversationId, title);
        } catch (err) {
          console.error("conversation title generation failed", err);
        }
      }
    },
  });

  return result.toUIMessageStreamResponse();
}
