import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useVoiceIo } from "@/hooks/use-voice-io";

interface FakeUtterance {
  text: string;
  onend: (() => void) | null;
  onerror: (() => void) | null;
}

let spoken: FakeUtterance[] = [];
let cancelCalls = 0;

class FakeUtteranceCtor implements FakeUtterance {
  onend: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(public text: string) {}
}

beforeEach(() => {
  spoken = [];
  cancelCalls = 0;
  vi.stubGlobal("SpeechSynthesisUtterance", FakeUtteranceCtor);
  vi.stubGlobal("speechSynthesis", {
    speak: (u: FakeUtterance) => spoken.push(u),
    cancel: () => {
      cancelCalls += 1;
    },
  });
  window.speechSynthesis = globalThis.speechSynthesis;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useVoiceIo speech", () => {
  it("speaks sanitized text, not the raw markdown it was handed", () => {
    const { result } = renderHook(() => useVoiceIo());
    act(() => result.current.speak("**Nice** work 🎉"));

    expect(spoken).toHaveLength(1);
    expect(spoken[0].text).toBe("Nice work");
  });

  it("says nothing when the text sanitizes down to nothing", () => {
    const { result } = renderHook(() => useVoiceIo());
    act(() => result.current.speak("🎉🚀"));

    expect(spoken).toHaveLength(0);
    expect(result.current.speaking).toBe(false);
  });

  it("reports which message is speaking and clears it when the utterance ends", () => {
    const { result } = renderHook(() => useVoiceIo());
    act(() => result.current.speak("hello there", "msg-1"));
    expect(result.current.speakingId).toBe("msg-1");
    expect(result.current.speaking).toBe(true);

    act(() => spoken[0].onend?.());
    expect(result.current.speakingId).toBeNull();
    expect(result.current.speaking).toBe(false);
  });

  it("clears the speaking state when the utterance errors", () => {
    const { result } = renderHook(() => useVoiceIo());
    act(() => result.current.speak("hello there", "msg-1"));
    act(() => spoken[0].onerror?.());

    expect(result.current.speaking).toBe(false);
  });

  it("cancel() stops the synthesiser and clears the speaking state", () => {
    const { result } = renderHook(() => useVoiceIo());
    act(() => result.current.speak("hello there", "msg-1"));
    act(() => result.current.cancel());

    expect(cancelCalls).toBeGreaterThan(0);
    expect(result.current.speaking).toBe(false);
  });

  /* cancel() fires `end` on the utterance it kills. Without the identity guard
     that stale event lands after the replacement has started and wrongly
     reports the new message as finished, leaving a Stop button that does
     nothing. */
  it("ignores an end event from an utterance that was already replaced", () => {
    const { result } = renderHook(() => useVoiceIo());
    act(() => result.current.speak("first message", "msg-1"));
    const first = spoken[0];

    act(() => result.current.speak("second message", "msg-2"));
    expect(result.current.speakingId).toBe("msg-2");

    act(() => first.onend?.());
    expect(result.current.speakingId).toBe("msg-2");

    act(() => spoken[1].onend?.());
    expect(result.current.speakingId).toBeNull();
  });

  it("starting a new message cancels the one in flight", () => {
    const { result } = renderHook(() => useVoiceIo());
    act(() => result.current.speak("first", "msg-1"));
    const before = cancelCalls;
    act(() => result.current.speak("second", "msg-2"));

    expect(cancelCalls).toBeGreaterThan(before);
    expect(spoken).toHaveLength(2);
  });

  it("stops speaking when the component unmounts", () => {
    const { result, unmount } = renderHook(() => useVoiceIo());
    act(() => result.current.speak("hello there", "msg-1"));
    const before = cancelCalls;
    unmount();

    expect(cancelCalls).toBeGreaterThan(before);
  });
});
