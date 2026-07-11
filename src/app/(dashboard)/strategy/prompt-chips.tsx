"use client";

import type { ConversationMode } from "@/app/api/chat/ensure-conversation";

const STRATEGY_PROMPTS = [
  "I am launching a new product",
  "Running a seasonal sale",
  "Building brand awareness",
  "Re-engaging customers",
  "Growing my social media",
  "Content for a new platform",
];

const DESIGN_PROMPTS = [
  "I need an Instagram carousel",
  "A flyer for an upcoming event",
  "A LinkedIn post visual",
  "A banner for my website",
  "A story for a promotion",
  "Something else",
];

interface PromptChipsProps {
  onPick: (text: string) => void;
  mode?: ConversationMode;
}

export function PromptChips({ onPick, mode = "strategy" }: PromptChipsProps) {
  const prompts = mode === "design" ? DESIGN_PROMPTS : STRATEGY_PROMPTS;
  return (
    <div className="flex flex-wrap gap-2 mt-2 ml-10 max-w-[560px]">
      {prompts.map((text) => (
        <button
          key={text}
          type="button"
          onClick={() => onPick(text)}
          className="min-h-[40px] rounded-full bg-[rgba(255,255,255,0.06)] px-4 py-2 text-[13px] text-[var(--text-secondary)] hover:bg-[rgba(19,139,200,0.12)] hover:text-foreground transition-colors"
        >
          {text}
        </button>
      ))}
    </div>
  );
}
