"use client";

import { Send, Square } from "lucide-react";
import { useRef } from "react";

interface ChatInputProps {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  onStop: () => void;
  isLoading: boolean;
}

export function ChatInput({
  value,
  onChange,
  onSend,
  onStop,
  isLoading,
}: ChatInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    onChange(e.target.value);
    const el = e.target;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      onSend();
    }
  };

  const handleSend = () => {
    onSend();
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  };

  return (
    <div className="sticky bottom-0 px-4 pb-4 pt-2 bg-background border-t border-[rgba(255,255,255,0.06)]">
      <div className="flex items-end gap-2 bg-surface-1 rounded-2xl px-4 py-3 border border-[rgba(255,255,255,0.08)]">
        <textarea
          ref={textareaRef}
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder="Describe your campaign, product, or goal…"
          rows={1}
          aria-label="Message input"
          className="flex-1 bg-transparent border-0 resize-none text-sm text-foreground placeholder:text-[var(--text-secondary)] focus:outline-none focus:ring-0 min-h-[40px] max-h-[160px] py-1"
        />

        {isLoading ? (
          <button
            type="button"
            onClick={onStop}
            aria-label="Stop generating"
            className="w-8 h-8 rounded-full bg-[rgba(255,255,255,0.1)] flex items-center justify-center hover:bg-[rgba(255,255,255,0.15)] transition-colors shrink-0"
          >
            <Square className="w-3.5 h-3.5 text-foreground" />
          </button>
        ) : (
          <button
            type="button"
            onClick={handleSend}
            disabled={!value.trim() || isLoading}
            aria-label="Send message"
            className="w-8 h-8 rounded-full bg-primary flex items-center justify-center hover:bg-[var(--primary-hover)] disabled:opacity-40 disabled:pointer-events-none transition-colors shrink-0"
          >
            <Send className="w-3.5 h-3.5 text-white" />
          </button>
        )}
      </div>
      <p className="text-[11px] text-[var(--text-muted)] mt-1.5 px-1">
        AI can make mistakes — review responses carefully.
      </p>
    </div>
  );
}
