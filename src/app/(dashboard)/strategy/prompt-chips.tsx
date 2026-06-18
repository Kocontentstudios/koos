"use client";

const PROMPTS = [
  "I am launching a new product",
  "Running a seasonal sale",
  "Building brand awareness",
  "Re-engaging customers",
  "Growing my social media",
  "Content for a new platform",
];

interface PromptChipsProps {
  onPick: (text: string) => void;
}

export function PromptChips({ onPick }: PromptChipsProps) {
  return (
    <div className="flex flex-wrap justify-center gap-2 mt-4">
      {PROMPTS.map((text) => (
        <button
          key={text}
          type="button"
          onClick={() => onPick(text)}
          className="rounded-full bg-[rgba(255,255,255,0.06)] px-4 py-2 text-[13px] text-[var(--text-secondary)] hover:bg-[rgba(19,139,200,0.12)] hover:text-foreground transition-colors"
        >
          {text}
        </button>
      ))}
    </div>
  );
}
