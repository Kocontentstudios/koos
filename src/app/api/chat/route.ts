import { convertToModelMessages, streamText, type UIMessage } from "ai";
import { flattenMessageText } from "@/lib/ai/chat-messages";
import type { ChatBrandContext } from "@/lib/ai/prompts/chat";
import { buildChatPrompt } from "@/lib/ai/prompts/chat";
import { getModel } from "@/lib/ai/provider";
import { getAuthUser } from "@/lib/auth/get-user";
import {
  createConversation,
  createMessage,
  getBrandById,
  getConversationById,
  touchConversation,
} from "@/lib/db/queries";
import { ensureConversation } from "./ensure-conversation";

export async function POST(req: Request) {
  // Authenticated users only — this endpoint spends AI tokens.
  const { dbUser } = await getAuthUser();
  if (!dbUser) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { messages, brandContext, brandId, conversationId } =
    (await req.json()) as {
      messages: UIMessage[];
      brandContext: ChatBrandContext;
      brandId: string;
      conversationId: string;
    };

  if (!brandId || !conversationId) {
    return Response.json(
      { error: "Missing brandId or conversationId" },
      { status: 400 },
    );
  }

  // Verify the brand belongs to the caller before persisting under it.
  const brand = await getBrandById(brandId);
  if (!brand || brand.userId !== dbUser.id) {
    return Response.json({ error: "Brand not found" }, { status: 404 });
  }

  const ensured = await ensureConversation(
    { getConversationById, createConversation },
    { conversationId, brandId, userId: dbUser.id },
  );
  if (!ensured.ok) {
    return Response.json({ error: ensured.error }, { status: ensured.status });
  }

  const systemPrompt = buildChatPrompt(brandContext);
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
    },
  });

  return result.toUIMessageStreamResponse();
}
