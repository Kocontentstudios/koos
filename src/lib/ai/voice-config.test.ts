import { describe, expect, it } from "vitest";
import { resolveVoiceConfig } from "./provider-config";

describe("resolveVoiceConfig", () => {
  it("defaults both to browser", () => {
    expect(resolveVoiceConfig({})).toEqual({ stt: "browser", tts: "browser" });
  });

  it("honors env overrides", () => {
    expect(
      resolveVoiceConfig({
        AI_STT_PROVIDER: "openai",
        AI_TTS_PROVIDER: "elevenlabs",
      }),
    ).toEqual({ stt: "openai", tts: "elevenlabs" });
  });
});
