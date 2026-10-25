import { describe, expect, it } from "vitest";
import {
  LOGO,
  LOGO_ASPECT,
  monospaceMeasurer,
  PALETTE,
  REALISTIC,
  REFUSED_COPY,
  SCRIPTS,
  specFor,
} from "./fixtures";
import { documentFromSpec, specTextFault } from "./from-spec";
import { designDocumentSchema } from "./schema";
import {
  DocumentTextFault,
  documentEmojiFault,
  isEmojiCluster,
  MAX_EMOJI_IN_SEQUENCE,
  MAX_EMOJI_PER_DOCUMENT,
  MAX_EMOJI_PER_TEXT,
  normalizeText,
  TEXT_CLUSTER_TOO_COMPLEX,
  TEXT_TOO_MANY_EMOJI,
  textFault,
} from "./text-safety";

const faultOf = (text: string) => textFault(normalizeText(text))?.code ?? null;

describe("textFault", () => {
  it.each(Object.entries(REFUSED_COPY))(
    "refuses %s with its fault, never by throwing",
    (_, [text, code]) => {
      expect(faultOf(text)).toBe(code);
    },
  );

  it.each([
    ["Latin", "Fresh croissants, baked before sunrise"],
    ["accented capitals", "Réservez Égjpqy Ågjpqy Ügjpq Éjq"],
    ["Yoruba with precomposed letters", "Ẹ ṣé o, ọjà tuntun ní Ìbàdàn"],
    ["Greek", "Φρέσκα κρουασάν κάθε πρωί"],
    ["Cyrillic", "Свежие круассаны каждое утро"],
    ["Korean", "매일 아침 신선한 크루아상"],
    ["Han with a variation selector", "葛\u{E0100}城"],
    [
      "England, Scotland and Wales",
      "🏴\u{E0067}\u{E0062}\u{E0065}\u{E006E}\u{E0067}\u{E007F} 🏴\u{E0067}\u{E0062}\u{E0077}\u{E006C}\u{E0073}\u{E007F}",
    ],
    ...Object.entries(SCRIPTS).flatMap(([name, copy]) =>
      [copy.headline, copy.subheadline, copy.cta].map(
        (text): [string, string] => [name, text],
      ),
    ),
  ])("draws %s", (_, text) => {
    expect(faultOf(text)).toBeNull();
  });

  it("composes Vietnamese typed decomposed (NFD) before judging it", () => {
    const typed = "ẪỄỖẶẬ ỖNG BÀ".normalize("NFD");
    expect(typed).not.toBe(typed.normalize("NFC"));
    expect(faultOf(typed)).toBeNull();
  });

  it("allows the emoji keycap's two marks and drops a stray third", () => {
    expect(faultOf("1\u{FE0F}\u{20E3}")).toBeNull();
    expect(normalizeText("1\u{FE0F}\u{20E3}\u{FE0F}")).toBe(
      "1\u{FE0F}\u{20E3}",
    );
    expect(faultOf("1\u{20E3}\u{20E3}\u{20E3}")).toBe(TEXT_CLUSTER_TOO_COMPLEX);
  });

  /* A browser draws a sequence no emoji set knows as its separate
     pictures, so unjoining it draws the same thing as one unit per person. */
  it("allows sequences of at most four people, the longest real family", () => {
    /* Pinned as a literal: checked only against itself, the constant could
       be raised to any length with every test green. */
    expect(MAX_EMOJI_IN_SEQUENCE).toBe(4);
  });

  it("unjoins a chain longer than any real emoji sequence", () => {
    const family = Array(MAX_EMOJI_IN_SEQUENCE).fill("👨").join("‍");
    expect(normalizeText(family)).toBe(family);
    const chain = Array(MAX_EMOJI_IN_SEQUENCE + 1)
      .fill("👨")
      .join("‍");
    expect(normalizeText(chain)).toBe("👨".repeat(MAX_EMOJI_IN_SEQUENCE + 1));
    expect(faultOf(chain)).toBeNull();
  });

  /* Six jamo in a row are one cluster satori draws as six letters; at 100px
     in a 300px box that looped it until the worker was killed. */
  it("composes Hangul typed as jamo and refuses jamo that form no syllable", () => {
    const typed = "한국어".normalize("NFD");
    expect(Array.from(typed).length).toBe(8);
    expect(normalizeText(typed)).toBe("한국어");
    expect(faultOf(typed)).toBeNull();
    expect(faultOf("ᄀ".repeat(6))).toBe(TEXT_CLUSTER_TOO_COMPLEX);
    expect(faultOf("ᄒᆞᆫ")).toBe(TEXT_CLUSTER_TOO_COMPLEX);
    expect(faultOf("ᄀ")).toBeNull();
  });

  it("keeps the three subdivision flags and strips tag characters elsewhere", () => {
    const scotland = "🏴\u{E0067}\u{E0062}\u{E0073}\u{E0063}\u{E0074}\u{E007F}";
    expect(normalizeText(scotland)).toBe(scotland);
    expect(isEmojiCluster(scotland)).toBe(true);
    expect(normalizeText(`a${"\u{E0061}".repeat(11)}`)).toBe("a");
    expect(normalizeText(`🏴${"\u{E0061}".repeat(10)}\u{E007F}`)).toBe("🏴");
  });

  it("strips joiners and selectors that join nothing", () => {
    expect(normalizeText("a\u200Db")).toBe("ab");
    expect(normalizeText("#\u{FE0F} tag")).toBe("# tag");
    expect(normalizeText("⸻\u{FE0F}")).toBe("⸻");
    expect(normalizeText("©\u{FE0E}")).toBe("©");
    expect(normalizeText("葛\u{E0100}城")).toBe("葛城");
    expect(normalizeText("❤\u{FE0F}")).toBe("❤\u{FE0F}");
    expect(normalizeText("1\u{FE0F}\u{20E3}")).toBe("1\u{FE0F}\u{20E3}");
    const family = "👨‍👩‍👧‍👦";
    expect(normalizeText(family)).toBe(family);
  });

  it("is idempotent", () => {
    for (const text of [
      `a\u200D${"\u{E0061}".repeat(3)}b`,
      "#\u{FE0F}\u{FE0F}\u20E3",
      "👨‍👩‍👧‍👦‍👦‍👦",
      "ᄀᄀᄀ가ᅡᆨ",
    ]) {
      expect(normalizeText(normalizeText(text))).toBe(normalizeText(text));
    }
  });

  it("refuses a skin tone on something that is not a person", () => {
    expect(faultOf("a🏽")).toBe(TEXT_CLUSTER_TOO_COMPLEX);
    expect(faultOf("👍🏽")).toBeNull();
  });

  it("caps emoji per run", () => {
    expect(faultOf("🥐".repeat(MAX_EMOJI_PER_TEXT))).toBeNull();
    expect(faultOf("🥐".repeat(MAX_EMOJI_PER_TEXT + 1))).toBe(
      TEXT_TOO_MANY_EMOJI,
    );
  });

  it("caps distinct emoji over a whole document", () => {
    const pool = Array.from({ length: MAX_EMOJI_PER_DOCUMENT + 1 }, (_, i) =>
      String.fromCodePoint(0x1f600 + i),
    );
    const half = Math.ceil(pool.length / 2);
    expect(documentEmojiFault([pool.slice(0, half).join("")])).toBeNull();
    expect(
      documentEmojiFault([
        pool.slice(0, half).join(""),
        pool.slice(half).join(""),
      ])?.code,
    ).toBe(TEXT_TOO_MANY_EMOJI);
    expect(documentEmojiFault(["🥐🥐", "🥐"])).toBeNull();
  });

  it("keeps line breaks and tabs, which are not control characters to it", () => {
    expect(faultOf("Fresh\ncroissants\tdaily")).toBeNull();
  });
});

describe("the schema boundary", () => {
  const doc = (text: string) => ({
    version: 1,
    width: 1080,
    height: 1350,
    background: "#FFFFFF",
    elements: [
      {
        id: "headline",
        name: "Headline",
        type: "text",
        x: 0,
        y: 0,
        width: 300,
        height: 300,
        rotation: 0,
        opacity: 1,
        hidden: false,
        locked: false,
        text,
        role: "headline",
        font: "heading",
        fontSize: 100,
        fontWeight: 700,
        lineHeight: 1.1,
        letterSpacing: 0,
        align: "left",
        italic: false,
        color: "#000000",
      },
    ],
  });

  /* The cluster that looped satori forever in a 300px box at 100px type. */
  it("refuses the cluster that hung the renderer", () => {
    const result = designDocumentSchema.safeParse(doc("Z̷̢̛͓̳̦͍̞̓̍͛"));
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain(
      TEXT_CLUSTER_TOO_COMPLEX,
    );
  });

  it("stores copy normalised to NFC", () => {
    const parsed = designDocumentSchema.parse(doc("Tiếng Việt"));
    const text = (parsed.elements[0] as { text: string }).text;
    expect(text).toBe("Tiếng Việt");
  });

  it.each(Object.entries(REFUSED_COPY))("refuses %s copy", (_, [text]) => {
    expect(designDocumentSchema.safeParse(doc(text)).success).toBe(false);
  });
});

describe("documentFromSpec and copy it cannot draw", () => {
  it.each(Object.entries(REFUSED_COPY))(
    "names the %s fault and the field before any render",
    async (_, [text, code]) => {
      const spec = specFor("hero-center", "4:5", {
        ...REALISTIC,
        subheadline: text,
      });
      expect(specTextFault(spec)).toMatchObject({ code, field: "subheadline" });
      const measurer = monospaceMeasurer();
      const build = documentFromSpec({
        spec,
        palette: PALETTE,
        canvas: { width: 1080, height: 1350 },
        image: null,
        logo: { asset: LOGO, aspect: LOGO_ASPECT },
        measurer,
      });
      await expect(build).rejects.toBeInstanceOf(DocumentTextFault);
      await expect(build).rejects.toMatchObject({ code, field: "subheadline" });
      expect(measurer.calls).toBe(0);
    },
  );

  it("checks footer lines as well", () => {
    const spec = specFor("hero-center", "4:5", {
      ...REALISTIC,
      footerStyle: "text",
      footerLines: ["0803 555 0142", REFUSED_COPY.arabic[0]],
    });
    expect(specTextFault(spec)?.field).toBe("footer");
  });
});
