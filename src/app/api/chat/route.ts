import {
  convertToModelMessages,
  generateText,
  stepCountIs,
  streamText,
  type UIMessage,
} from "ai";
import { flattenMessageText } from "@/lib/ai/chat-messages";
import { buildMemoryBlock, summarizeIntoMemory } from "@/lib/ai/memory";
import type { ChatBrandContext } from "@/lib/ai/prompts/chat";
import { buildChatPrompt } from "@/lib/ai/prompts/chat";
import { buildDesignRequestChatPrompt } from "@/lib/ai/prompts/design-request";
import { buildOnboardingPrompt } from "@/lib/ai/prompts/onboarding";
import { getModel } from "@/lib/ai/provider";
import { resolveProviderConfig } from "@/lib/ai/provider-config";
import { buildBrandTools, providerSupportsTools } from "@/lib/ai/tools";
import { captureServerEvent } from "@/lib/analytics/posthog-server";
import { getAnalyticsSessionId } from "@/lib/analytics/session-id";
import { getAuthUser } from "@/lib/auth/get-user";
import {
  checkBrandAccess,
  createConversation,
  createMessage,
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

  // Verify the caller has workspace access to the brand before persisting.
  const access = await checkBrandAccess(dbUser.id, brandId, "manage_content");
  if (!access.ok) {
    return Response.json({ error: access.error }, { status: access.status });
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

  if (ensured.created) {
    await captureServerEvent({
      distinctId: dbUser.id,
      event: "chat_started",
      properties: {
        brand_id: brandId,
        mode: chatMode,
        session_id: await getAnalyticsSessionId(),
      },
    });
  }

  // The persisted mode must stay within the conversation_mode enum
  // (strategy/design only — see chatMode above), but the SYSTEM PROMPT
  // switches on the raw incoming mode so "onboarding" gets its own
  // interviewer prompt without needing a DB migration.
  const systemPrompt =
    mode === "design"
      ? buildDesignRequestChatPrompt(brandContext)
      : mode === "onboarding"
        ? buildOnboardingPrompt()
        : buildChatPrompt({ memorySummary: await buildMemoryBlock(brandId) });
  const modelMessages = await convertToModelMessages(messages);

  // The just-sent user message is the last item; capture it for persistence.
  const lastUserMessage = messages[messages.length - 1];

  // Onboarding stays tool-free: the explicit extract-and-confirm flow (Task
  // 12 + ProposalCard) is what writes brand fields, so keeping this an
  // unencumbered interview avoids the model reaching for propose_* mid-chat.
  const useTools =
    mode !== "onboarding" &&
    providerSupportsTools(resolveProviderConfig("chat").provider);

  const result = streamText({
    model: getModel("chat"),
    system: systemPrompt,
    messages: modelMessages,
    ...(useTools
      ? {
          tools: buildBrandTools({ userId: dbUser.id, brandId }),
          stopWhen: stepCountIs(6),
        }
      : {}),
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

      // Best-effort brand memory update. Runs for both modes so design-mode
      // conversations still accrue durable brand facts; summarizeIntoMemory
      // already swallows its own errors.
      if (lastUserMessage?.role === "user") {
        await summarizeIntoMemory({
          brandId,
          userText: flattenMessageText(lastUserMessage),
          assistantText: text,
        });
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
