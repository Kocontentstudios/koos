"use client";

import { useChat } from "@ai-sdk/react";
import type { UIMessage } from "ai";
import { DefaultChatTransport } from "ai";
import { PanelLeftOpen, PanelRight, PanelsTopLeft, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import type { ConversationMode } from "@/app/api/chat/ensure-conversation";
import { Button } from "@/components/ui/button";
import type { DesignBrief } from "@/lib/ai/design-brief-schema";
import type { ChatBrandContext } from "@/lib/ai/prompts/chat";
import type { Strategy } from "@/lib/ai/strategy-schema";
import {
  clearActiveGeneration,
  startActiveGeneration,
} from "@/lib/generation/active-job";
import { pollGenerationJob } from "@/lib/generation/poll-job";
import { cn } from "@/lib/utils";
import { loadStrategy, markStrategyActive } from "./actions";
import { ChatInput } from "./chat-input";
import { DesignBriefPanel } from "./design-brief-panel";
import { MessageList } from "./message-list";
import { PromptChips } from "./prompt-chips";
import {
  type ConversationListItem,
  StrategyHistory,
  type StrategyHistoryItem,
} from "./strategy-history";
import { StrategyPanel } from "./strategy-panel";

/** Loader texts shown while waiting for the first server progress update
    (and between updates once progress stops arriving). */
const CALENDAR_WAIT_LABELS = [
  "Generating your calendar…",
  "Studying your strategy…",
  "Mapping out posting slots…",
  "Writing content briefs…",
  "Almost there — polishing the plan…",
];

interface StrategyClientProps {
  brandId: string;
  brandContext: ChatBrandContext;
  brandName: string;
  /** Strategies not reachable through a listed chat. */
  olderStrategies?: StrategyHistoryItem[];
  conversations?: ConversationListItem[];
  initialMessages?: UIMessage[];
  initialConversationId?: string | null;
  /** "design" opens the workspace in Design Request Mode. */
  initialMode?: ConversationMode;
}

export function StrategyClient({
  brandId,
  brandContext,
  brandName,
  olderStrategies = [],
  conversations = [],
  initialMessages = [],
  initialConversationId = null,
  initialMode = "strategy",
}: StrategyClientProps) {
  const router = useRouter();
  const [conversationId, setConversationId] = useState<string>(
    () => initialConversationId ?? crypto.randomUUID(),
  );
  const [mode, setMode] = useState<ConversationMode>(initialMode);
  const [input, setInput] = useState("");
  const [strategy, setStrategy] = useState<Strategy | null>(null);
  const [strategyId, setStrategyId] = useState<string | null>(null);
  const [brief, setBrief] = useState<DesignBrief | null>(null);
  const [buildPending, setBuildPending] = useState(false);
  const [buildError, setBuildError] = useState<string | null>(null);
  const [calendarPending, setCalendarPending] = useState(false);
  const [calendarError, setCalendarError] = useState<string | null>(null);
  const [calendarProgress, setCalendarProgress] = useState<string | null>(null);
  // Rotates the loader text between server progress updates, and after 45s
  // tells the user they're free to leave (the GenerationWatcher will toast).
  const [calendarWaitTick, setCalendarWaitTick] = useState(0);
  const [calendarHintVisible, setCalendarHintVisible] = useState(false);

  useEffect(() => {
    if (!calendarPending) {
      setCalendarWaitTick(0);
      setCalendarHintVisible(false);
      return;
    }
    const rotate = setInterval(() => setCalendarWaitTick((n) => n + 1), 5_000);
    const hint = setTimeout(() => setCalendarHintVisible(true), 45_000);
    return () => {
      clearInterval(rotate);
      clearTimeout(hint);
    };
  }, [calendarPending]);
  const [panelCollapsed, setPanelCollapsed] = useState(false);
  // Desktop-only: collapse the left history panel to a slim icon rail.
  const [historyCollapsed, setHistoryCollapsed] = useState(false);
  // Mobile-only drawer state for the history and summary panels (below `lg`).
  const [historyOpen, setHistoryOpen] = useState(false);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [loadingStrategyId, setLoadingStrategyId] = useState<string | null>(
    null,
  );
  const [loadingConversationId, setLoadingConversationId] = useState<
    string | null
  >(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/chat",
        body: { brandContext, brandId, conversationId, mode },
      }),
    [brandContext, brandId, conversationId, mode],
  );

  const {
    messages,
    status,
    sendMessage,
    stop,
    error,
    regenerate,
    setMessages,
  } = useChat({ transport, messages: initialMessages });

  const isLoading = status === "submitted" || status === "streaming";

  const handleSend = () => {
    const text = input.trim();
    if (!text || isLoading) return;
    sendMessage(
      { text },
      { body: { brandContext, brandId, conversationId, mode } },
    );
    setInput("");
  };

  const handlePickChip = (text: string) => {
    sendMessage(
      { text },
      { body: { brandContext, brandId, conversationId, mode } },
    );
  };

  const handleBuildStrategy = async () => {
    setBuildPending(true);
    setBuildError(null);
    const conversation = messages
      .map((m) => {
        const text =
          m.parts
            ?.filter(
              (p): p is Extract<(typeof m.parts)[number], { type: "text" }> =>
                p.type === "text",
            )
            .map((p) => p.text)
            .join("") ?? "";
        return `${m.role}: ${text}`;
      })
      .join("\n\n");

    try {
      // The generate route returns 202 + a job id immediately; poll for the
      // result so no request is held open long enough to hit proxy timeouts.
      const res = await fetch("/api/strategy/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brandId, conversation, conversationId }),
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error ?? "Strategy generation failed");
      }
      const { jobId } = (await res.json()) as { jobId: string };
      const data = await pollGenerationJob<{
        strategy: Strategy;
        strategyId: string;
      }>(jobId);
      setStrategy(data.strategy);
      setStrategyId(data.strategyId);
      setPanelCollapsed(false);
      setSummaryOpen(true);
    } catch (err) {
      setBuildError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setBuildPending(false);
    }
  };

  const handleGenerateCalendar = async () => {
    if (!strategyId) return;
    setCalendarPending(true);
    setCalendarError(null);
    setCalendarProgress(null);
    let jobId: string | null = null;
    try {
      await markStrategyActive(strategyId);
      const res = await fetch("/api/calendar/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ strategyId }),
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error ?? "Calendar generation failed");
      }
      ({ jobId } = (await res.json()) as { jobId: string });
      // Hand the job to the layout-level GenerationWatcher: it survives
      // navigation and owns the completion/failure toast, so leaving this
      // page no longer abandons the generation.
      startActiveGeneration({ jobId, kind: "calendar" });
      const { calendarId } = await pollGenerationJob<{ calendarId: string }>(
        jobId,
        {
          // The watcher's poll (and the server's stale-job detector) bound
          // the run; this page-local poll only drives the inline loader and
          // must not declare failure at the old 5-minute mark.
          timeoutMs: 30 * 60 * 1000,
          onProgress: (p) => setCalendarProgress(p.label),
        },
      );
      clearActiveGeneration(jobId);
      router.push(`/calendar?calendarId=${calendarId}`);
    } catch (err) {
      if (jobId) clearActiveGeneration(jobId);
      setCalendarError(
        err instanceof Error ? err.message : "An error occurred",
      );
      setCalendarPending(false);
      setCalendarProgress(null);
    }
  };

  // In design mode the build button generates a structured design brief
  // instead of a strategy; the brief lands in the right-hand panel for review.
  const handleGenerateBrief = async () => {
    setBuildPending(true);
    setBuildError(null);
    const conversation = messages
      .map((m) => {
        const text =
          m.parts
            ?.filter(
              (p): p is Extract<(typeof m.parts)[number], { type: "text" }> =>
                p.type === "text",
            )
            .map((p) => p.text)
            .join("") ?? "";
        return `${m.role}: ${text}`;
      })
      .join("\n\n");

    try {
      const res = await fetch("/api/design-brief/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brandId, conversation }),
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error ?? "Brief generation failed");
      }
      const { jobId } = (await res.json()) as { jobId: string };
      const data = await pollGenerationJob<{ brief: DesignBrief }>(jobId);
      setBrief(data.brief);
      setPanelCollapsed(false);
      setSummaryOpen(true);
    } catch (err) {
      setBuildError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setBuildPending(false);
    }
  };

  const handleNewStrategy = () => {
    setConversationId(crypto.randomUUID());
    setMessages([]);
    setStrategy(null);
    setStrategyId(null);
    setBrief(null);
    setBuildError(null);
    setLoadError(null);
    setHistoryOpen(false);
  };

  // Reopen a persisted conversation: fetch its messages and make it the
  // active chat (subsequent turns append to the same conversation row).
  const handleSelectConversation = async (id: string) => {
    if (id === conversationId || loadingConversationId) return;
    setLoadError(null);
    setLoadingConversationId(id);
    try {
      const res = await fetch(`/api/chat/conversations/${id}`);
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(body.error ?? "Could not load chat.");
      }
      const data = (await res.json()) as { messages: UIMessage[] };
      setConversationId(id);
      // Follow the reopened conversation's mode so replies use the right prompt.
      const reopened = conversations.find((c) => c.id === id);
      if (reopened?.mode) setMode(reopened.mode);
      setMessages(data.messages);
      setStrategy(null);
      setStrategyId(null);
      setBrief(null);
      setBuildError(null);
      setHistoryOpen(false);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Could not load chat.");
    } finally {
      setLoadingConversationId(null);
    }
  };

  // Open the current chat's saved strategy in the summary panel WITHOUT
  // touching the conversation — unlike handleSelectStrategy, which replaces
  // the chat with a recap (kept for the sidebar's Older Strategies list).
  const handleViewStrategy = async (id: string) => {
    if (loadingStrategyId) return;
    setLoadError(null);
    setLoadingStrategyId(id);
    try {
      const res = await loadStrategy(id);
      if (!res.ok) {
        setLoadError(res.error);
        return;
      }
      setStrategy(res.strategy);
      setStrategyId(id);
      setPanelCollapsed(false);
      setSummaryOpen(true);
    } catch {
      setLoadError("Could not load strategy.");
    } finally {
      setLoadingStrategyId(null);
    }
  };

  // Load a saved strategy into the summary/card and seed the chat with a recap
  // so the user can keep refining it and rebuild.
  const handleSelectStrategy = async (id: string) => {
    if (loadingStrategyId) return;
    setLoadError(null);
    setLoadingStrategyId(id);
    try {
      const res = await loadStrategy(id);
      if (!res.ok) {
        setLoadError(res.error);
        return;
      }
      const s = res.strategy;
      setStrategy(s);
      setStrategyId(id);
      const recap = [
        `I've loaded your saved strategy "${s.campaignName}".`,
        "",
        `Objective: ${s.objective}`,
        `Key message: ${s.keyMessage}`,
        `Channels: ${s.channels.map((c) => c.name).join(", ")}`,
        "",
        "Tell me what you'd like to change and I'll refine it, then you can rebuild the strategy.",
      ].join("\n");
      setMessages([
        {
          id: `loaded-${id}`,
          role: "assistant",
          parts: [{ type: "text", text: recap }],
        },
      ]);
      setPanelCollapsed(false);
      setSummaryOpen(true);
      setHistoryOpen(false);
    } catch {
      setLoadError("Could not load strategy.");
    } finally {
      setLoadingStrategyId(null);
    }
  };

  const isDesignMode = mode === "design";
  const showBuildButton =
    messages.length >= 2 && !(isDesignMode ? brief : strategy) && !isLoading;
  // The reopened chat's saved strategy, offered as a "View Strategy" action.
  const activeConversationStrategyId =
    conversations.find((c) => c.id === conversationId)?.strategyId ?? null;
  const showViewStrategy =
    !isDesignMode && !!activeConversationStrategyId && !strategy;

  return (
    <div className="h-[calc(100vh-56px)] flex overflow-hidden -mx-4 -my-6 md:-mx-8 md:-my-8">
      {/* Left history panel — desktop only, collapsible to a slim rail */}
      {historyCollapsed ? (
        <aside className="hidden w-12 shrink-0 flex-col items-center gap-2 border-r border-[var(--border)] bg-surface-1 py-4 lg:flex">
          <button
            type="button"
            onClick={() => setHistoryCollapsed(false)}
            aria-label="Expand history panel"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--text-secondary)] hover:bg-[var(--hover)] hover:text-foreground"
          >
            <PanelLeftOpen size={18} />
          </button>
          <button
            type="button"
            onClick={handleNewStrategy}
            aria-label="New chat"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--text-secondary)] hover:bg-[var(--hover)] hover:text-foreground"
          >
            <Plus size={18} />
          </button>
          <span className="mt-2 text-[11px] font-semibold uppercase tracking-widest text-[var(--text-muted)] [writing-mode:vertical-rl]">
            History
          </span>
        </aside>
      ) : (
        <aside className="hidden lg:flex w-[280px] flex-col border-r border-[var(--border)] bg-surface-1 overflow-hidden">
          <StrategyHistory
            olderStrategies={olderStrategies}
            activeId={strategyId}
            loadingId={loadingStrategyId}
            onSelect={handleSelectStrategy}
            onNew={handleNewStrategy}
            onCollapse={() => setHistoryCollapsed(true)}
            conversations={conversations}
            activeConversationId={conversationId}
            loadingConversationId={loadingConversationId}
            onSelectConversation={handleSelectConversation}
          />
        </aside>
      )}

      {/* Mobile history drawer + backdrop (below lg) */}
      {historyOpen && (
        <button
          type="button"
          aria-label="Close history"
          onClick={() => setHistoryOpen(false)}
          className="fixed inset-0 z-40 bg-[var(--backdrop)] lg:hidden"
        />
      )}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex w-[280px] max-w-[85vw] flex-col border-r border-[var(--border)] bg-surface-1 transition-transform duration-200 lg:hidden",
          historyOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <StrategyHistory
          olderStrategies={olderStrategies}
          activeId={strategyId}
          loadingId={loadingStrategyId}
          onSelect={handleSelectStrategy}
          onNew={handleNewStrategy}
          onClose={() => setHistoryOpen(false)}
          conversations={conversations}
          activeConversationId={conversationId}
          loadingConversationId={loadingConversationId}
          onSelectConversation={handleSelectConversation}
        />
      </aside>

      {/* Main chat area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Mobile toolbar — opens the history / summary drawers (below lg) */}
        <div className="flex items-center justify-between gap-2 border-b border-[var(--border)] px-3 py-2 lg:hidden">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              setSummaryOpen(false);
              setHistoryOpen(true);
            }}
          >
            <PanelsTopLeft className="size-4" />
            History
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              setHistoryOpen(false);
              setSummaryOpen(true);
            }}
          >
            Summary
            <PanelRight className="size-4" />
          </Button>
        </div>

        {/* Load error */}
        {loadError && (
          <div className="mx-4 mt-3 rounded-xl bg-[var(--status-error-bg)] px-4 py-2 text-sm text-[var(--status-error-fg)]">
            {loadError}
          </div>
        )}

        {/* This chat produced a strategy — open it without disturbing the chat */}
        {showViewStrategy && activeConversationStrategyId && (
          <div className="flex items-center justify-between gap-3 border-b border-[var(--border)] px-4 py-2">
            <span className="text-[13px] text-[var(--text-secondary)]">
              This chat has a saved strategy.
            </span>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => handleViewStrategy(activeConversationStrategyId)}
              loading={loadingStrategyId === activeConversationStrategyId}
              loadingText="Loading…"
              aria-label="View this chat's strategy"
            >
              View Strategy
            </Button>
          </div>
        )}

        {/* Empty state — KO welcome bubble + indented prompt chips */}
        {messages.length === 0 && (
          <div className="flex-1 overflow-y-auto px-4 py-6">
            <div className="flex items-start gap-3 max-w-[85%]">
              <div className="w-7 h-7 rounded-full bg-primary flex items-center justify-center shrink-0 text-white font-bold text-[11px]">
                KO
              </div>
              <div className="rounded-xl rounded-tl-sm border border-[var(--border)] bg-surface-1 px-4 py-3 text-sm leading-relaxed text-foreground">
                {isDesignMode
                  ? "Hi! I'm KO. Let's get your design request ready for the KO design team. Tell me what you need — what it's about, what it should achieve, and the format (flyer, carousel, banner…). Pick one to get started, or describe it in your own words."
                  : "Hi! I'm KO, your content strategist. Tell me about your campaign, product, or goal and I'll build a content strategy for you. Pick one to get started, or describe it in your own words."}
              </div>
            </div>
            <PromptChips onPick={handlePickChip} mode={mode} />
          </div>
        )}

        {/* Messages */}
        {messages.length > 0 && (
          <MessageList messages={messages} isLoading={isLoading} />
        )}

        {/* Error from useChat */}
        {error && (
          <div className="mx-4 mb-3 px-4 py-3 rounded-xl bg-[var(--status-error-bg)] text-[var(--status-error-fg)] text-sm flex items-center justify-between gap-3">
            <span>{error.message}</span>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => regenerate()}
              aria-label="Try again"
            >
              Try Again
            </Button>
          </div>
        )}

        {/* Build strategy + build error */}
        {(showBuildButton || buildError) && (
          <div className="px-4 pb-3 flex flex-col gap-2">
            {buildError && (
              <div className="px-4 py-2 rounded-xl bg-[var(--status-error-bg)] text-[var(--status-error-fg)] text-sm flex items-center justify-between gap-3">
                <span>{buildError}</span>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={
                    isDesignMode ? handleGenerateBrief : handleBuildStrategy
                  }
                  aria-label={
                    isDesignMode
                      ? "Retry generate design brief"
                      : "Retry build strategy"
                  }
                >
                  Retry
                </Button>
              </div>
            )}
            {showBuildButton && (
              <Button
                variant="default"
                onClick={
                  isDesignMode ? handleGenerateBrief : handleBuildStrategy
                }
                loading={buildPending}
                loadingText={isDesignMode ? "Generating…" : "Building…"}
                aria-label={
                  isDesignMode
                    ? "Generate design brief from conversation"
                    : "Build strategy from conversation"
                }
                className="self-start"
              >
                {isDesignMode
                  ? "Generate Design Brief"
                  : `Build Strategy for ${brandName}`}
              </Button>
            )}
          </div>
        )}

        {/* Chat input */}
        <ChatInput
          value={input}
          onChange={setInput}
          onSend={handleSend}
          onStop={stop}
          isLoading={isLoading}
        />
      </div>

      {/* Right panel — design brief in design mode, strategy summary otherwise */}
      {isDesignMode ? (
        <DesignBriefPanel
          brief={brief}
          brandId={brandId}
          collapsed={panelCollapsed}
          onToggleCollapsed={() => setPanelCollapsed((c) => !c)}
          onEdit={() => {
            setBrief(null);
            setSummaryOpen(false);
          }}
          mobileOpen={summaryOpen}
          onMobileClose={() => setSummaryOpen(false)}
        />
      ) : (
        <StrategyPanel
          strategy={strategy}
          collapsed={panelCollapsed}
          onToggleCollapsed={() => setPanelCollapsed((c) => !c)}
          onGenerateCalendar={handleGenerateCalendar}
          onEdit={() => {
            setStrategy(null);
            setSummaryOpen(false);
          }}
          generating={calendarPending}
          generatingLabel={
            calendarProgress ??
            CALENDAR_WAIT_LABELS[calendarWaitTick % CALENDAR_WAIT_LABELS.length]
          }
          generatingHint={
            calendarHintVisible
              ? "Your calendar is being generated — you'll be alerted when it's done. Feel free to keep working elsewhere."
              : null
          }
          calendarError={calendarError}
          mobileOpen={summaryOpen}
          onMobileClose={() => setSummaryOpen(false)}
        />
      )}
    </div>
  );
}
