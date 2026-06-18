import { convertToModelMessages, streamText, type UIMessage } from "ai";
import type { ChatBrandContext } from "@/lib/ai/prompts/chat";
import { buildChatPrompt } from "@/lib/ai/prompts/chat";
import { getModel } from "@/lib/ai/provider";

export async function POST(req: Request) {
  const { messages, brandContext } = (await req.json()) as {
    messages: UIMessage[];
    brandContext: ChatBrandContext;
  };

  const systemPrompt = buildChatPrompt(brandContext);

  const modelMessages = await convertToModelMessages(messages);

  const result = streamText({
    model: getModel("chat"),
    system: systemPrompt,
    messages: modelMessages,
  });

  return result.toUIMessageStreamResponse();
}
