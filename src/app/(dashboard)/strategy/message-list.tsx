"use client";

import type { UIMessage } from "@ai-sdk/react";
import { useEffect, useRef } from "react";

interface MessageListProps {
  messages: UIMessage[];
  isLoading: boolean;
}

function extractText(msg: UIMessage): string {
  return (
    msg.parts
      ?.filter(
        (p): p is Extract<typeof p, { type: "text" }> => p.type === "text",
      )
      .map((p) => p.text)
      .join("") ?? ""
  );
}

export function MessageList({ messages, isLoading }: MessageListProps) {
  const endRef = useRef<HTMLDivElement>(null);

  // Scroll to bottom when messages change or loading state changes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: messages/isLoading are intentional triggers
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);

  return (
    <div
      role="log"
      className="flex-1 overflow-y-auto px-4 py-6 space-y-4"
      aria-live="polite"
      aria-label="Conversation"
    >
      {messages.map((msg) => {
        const text = extractText(msg);
        const isUser = msg.role === "user";

        return (
          <div
            key={msg.id}
            className={`flex items-start gap-3 max-w-[85%] ${isUser ? "ml-auto flex-row-reverse" : ""}`}
          >
            {/* Avatar */}
            <div className="w-8 h-8 rounded-full bg-[rgba(19,139,200,0.2)] flex items-center justify-center shrink-0 text-primary font-bold text-[11px]">
              {isUser ? "U" : "K"}
            </div>

            {/* Bubble */}
            <div
              className={`rounded-2xl px-4 py-3 text-sm leading-relaxed whitespace-pre-line ${
                isUser
                  ? "bg-surface-2 text-foreground rounded-tr-sm"
                  : "bg-surface-1 text-foreground rounded-tl-sm"
              }`}
            >
              {text}
            </div>
          </div>
        );
      })}

      {/* Typing dots */}
      {isLoading && (
        <div className="flex items-start gap-3 max-w-[85%]">
          <div className="w-8 h-8 rounded-full bg-[rgba(19,139,200,0.2)] flex items-center justify-center shrink-0 text-primary font-bold text-[11px]">
            K
          </div>
          <div className="bg-surface-1 rounded-2xl rounded-tl-sm px-4 py-3">
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-primary inline-block animate-bounce [animation-delay:0ms]" />
              <span className="w-2 h-2 rounded-full bg-primary inline-block animate-bounce [animation-delay:150ms]" />
              <span className="w-2 h-2 rounded-full bg-primary inline-block animate-bounce [animation-delay:300ms]" />
            </div>
          </div>
        </div>
      )}

      <div ref={endRef} />
    </div>
  );
}
