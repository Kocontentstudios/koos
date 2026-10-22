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
  MAX_CODE_POINTS_PER_CLUSTER,
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
    ["Greek polytonic", "Ἀρχὴ ἥμισυ παντός"],
    ["Cyrillic", "Свежие круассаны каждое утро"],
    ["Korean", "매일 아침 신선한 크루아상"],
    ["Han with a variation selector", "葛\u{E0100}城"],
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

  it("allows the emoji keycap's two marks and refuses a third", () => {
    expect(faultOf("1\u{FE0F}\u{20E3}")).toBeNull();
    expect(faultOf("1\u{FE0F}\u{20E3}\u{FE0F}")).toBe(TEXT_CLUSTER_TOO_COMPLEX);
  });

  it("refuses a joiner chain longer than any real emoji sequence", () => {
    const chain = Array(MAX_CODE_POINTS_PER_CLUSTER).fill("👨").join("‍");
    expect(faultOf(chain)).toBe(TEXT_CLUSTER_TOO_COMPLEX);
  });

  it("caps emoji per run", () => {
    expect(faultOf("🥐".repeat(MAX_EMOJI_PER_TEXT))).toBeNull();
    expect(faultOf("🥐".repeat(MAX_EMOJI_PER_TEXT + 1))).toBe(
      TEXT_TOO_MANY_EMOJI,
    );
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
