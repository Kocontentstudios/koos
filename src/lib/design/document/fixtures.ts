import { SUPPORTED_ASPECT_RATIOS } from "@/lib/ai/image/types";
import type { ResolvedPalette } from "@/lib/design/palette";
import { logoPng } from "@/lib/design/render/logo-fixtures";
import { DESIGN_LAYOUTS, type DesignSpec } from "@/lib/design/spec";
import { encodePngRgba } from "@/lib/images/png-pixels";
import {
  lineBox,
  type TextLook,
  type TextMeasurer,
  unbreakableRuns,
} from "./fit";
import type { AssetRef } from "./schema";

/**
 * Shared inputs for the document tests: realistic copy, the schema's
 * worst-case copy, and small generated assets (no binaries in the repo).
 */

export const LAYOUTS = DESIGN_LAYOUTS;
export const RATIOS = SUPPORTED_ASPECT_RATIOS;

export const PALETTE: ResolvedPalette = {
  background: "#FFF4E6",
  foreground: "#3B2416",
  accent: "#C2410C",
};

export const IMAGE: AssetRef = { key: "design-images/b1/photo.png" };
export const LOGO: AssetRef = { key: "logos/b1/mark.png" };
export const LOGO_ASPECT = 4;

export function specFor(
  layout: DesignSpec["layout"],
  aspectRatio: DesignSpec["aspectRatio"],
  copy: Pick<
    DesignSpec,
    "headline" | "subheadline" | "cta" | "footerStyle" | "footerLines"
  > = REALISTIC,
): DesignSpec {
  return {
    layout,
    ...copy,
    palette: PALETTE,
    logoPlacement:
      layout === "quote-card" || layout === "stat-highlight"
        ? "top-right"
        : layout === "banner-bottom"
          ? "top-left"
          : "top-right",
    logoFree: false,
    logoFreeQuote: "",
    backgroundPrompt: "unused",
    backgroundTreatment: "photographic",
    nativePrompt: "unused",
    aspectRatio,
  };
}

export const REALISTIC = {
  headline: "Fresh croissants, baked before sunrise",
  subheadline:
    "Flaky, buttery and still warm. Come in early for the first batch of the day.",
  cta: "Order for pickup",
  footerStyle: "text" as const,
  footerLines: ["12 Admiralty Way, Lekki · Open daily 7am to 6pm"],
};

/** At the schema's limits: 70, 140 and 32 characters, three 60-character
 *  footer lines. */
export const WORST_CASE = {
  headline:
    "Our Christmas pre-order window closes Friday: reserve croissants now!!",
  subheadline:
    "Butter croissants, almond twice-baked, pain au chocolat and our seasonal panettone, all baked fresh at dawn, and boxed ready for collection.",
  cta: "Reserve your Christmas box today",
  footerStyle: "bar" as const,
  footerLines: [
    "12 Admiralty Way, Lekki Phase 1, Lagos · Mon-Sun 7am to 6pm.",
    "Call or WhatsApp 0803 555 0142 · hello@crumbandco.ng anytime",
    "Pre-orders close 20 December · Collect 23 or 24 Dec, 8am-1pm",
  ],
};

if (
  WORST_CASE.headline.length !== 70 ||
  WORST_CASE.subheadline.length !== 140 ||
  WORST_CASE.cta.length !== 32 ||
  WORST_CASE.footerLines.some((line) => line.length !== 60)
) {
  throw new Error("WORST_CASE copy must sit exactly at the schema limits");
}

/** A 4:1 mark and a small photo-like image, as real PNG bytes. */
export function testAssets() {
  return {
    [LOGO.key]: {
      bytes: logoPng({
        width: 200,
        height: 50,
        color: [59, 36, 22, 255],
        shape: "block",
      }),
      contentType: "image/png",
    },
    [IMAGE.key]: {
      bytes: logoPng({
        width: 96,
        height: 64,
        color: [200, 160, 120, 255],
        shape: "block",
      }),
      contentType: "image/png",
    },
  };
}

/**
 * A monospaced stand-in for satori: every character advances 0.5em, lines
 * break greedily at spaces, and a word longer than a line breaks inside
 * itself (render.tsx's break-word). Exact and instant, so the search logic
 * can be tested on its own; measure.smoke.test.tsx covers the real measurer.
 */
export function monospaceMeasurer(): TextMeasurer & { calls: number } {
  const advance = (look: TextLook) => look.fontSize * 0.5;
  const self = {
    calls: 0,
    async height(text: string, look: TextLook, width: number) {
      self.calls += 1;
      const perLine = Math.max(1, Math.floor(width / advance(look)));
      let lines = 1;
      let used = 0;
      for (const word of text.split(/\s+/).filter(Boolean)) {
        const needed = used === 0 ? word.length : used + 1 + word.length;
        if (needed <= perLine) {
          used = needed;
          continue;
        }
        if (used > 0) lines += 1;
        lines += Math.ceil(word.length / perLine) - 1;
        used = word.length % perLine || perLine;
      }
      return lines * lineBox(look);
    },
    async lineWidth(text: string, look: TextLook) {
      self.calls += 1;
      return Math.ceil(text.length * advance(look));
    },
    async widestWord(text: string, look: TextLook) {
      self.calls += 1;
      const longest = Math.max(
        0,
        ...unbreakableRuns(text).map((word) => word.length),
      );
      return Math.ceil(longest * advance(look));
    },
  };
  return self;
}

/**
 * Generated photographs and a cut-out, as real PNG bytes, for the image
 * handling tests: a near-white photo (the fixture that a fixed scrim
 * turned grey), a near-black one, a busy one that is half of each, and a
 * cut-out whose subject and soft shadow sit inside a transparent margin.
 */
export function syntheticImages() {
  const paint = (
    width: number,
    height: number,
    at: (x: number, y: number) => [number, number, number, number],
  ) => {
    const pixels = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        pixels.set(at(x, y), (y * width + x) * 4);
      }
    }
    return {
      bytes: encodePngRgba({ width, height, pixels }),
      contentType: "image/png",
    };
  };
  return {
    white: paint(300, 200, () => [250, 250, 248, 255]),
    black: paint(300, 200, () => [18, 14, 12, 255]),
    busy: paint(300, 200, (x, y) =>
      (Math.floor(x / 15) + Math.floor(y / 15)) % 2
        ? [245, 240, 235, 255]
        : [30, 20, 15, 255],
    ),
    /* Subject: an orange block from 30% to 70% across and 25% to 60% down,
       with a soft shadow below it to 75%. Everything else is transparent. */
    cutout: paint(400, 400, (x, y) => {
      const u = x / 400;
      const v = y / 400;
      if (u >= 0.3 && u < 0.7 && v >= 0.25 && v < 0.6) {
        return [214, 120, 40, 255];
      }
      if (u >= 0.25 && u < 0.75 && v >= 0.6 && v < 0.75) {
        return [0, 0, 0, 40];
      }
      return [0, 0, 0, 0];
    }),
  };
}

/** The cut-out's subject, shadow included, as shares of the image. */
export const CUTOUT_SUBJECT = {
  left: 0.25,
  top: 0.25,
  right: 0.75,
  bottom: 0.75,
};

/* Glyphs that reach furthest outside the line box: accented capitals above,
   descenders below, on every line whatever the wrap. */
export const OVERSHOOT = {
  ...WORST_CASE,
  headline:
    "Ålgjy Éjpqy Ügjpy Ångjy Éjgqy Ögjpy Åjgqy Éygjp Ügpqj Åjypq Égjyq Öjpg",
  subheadline:
    "Ågjpy Égqjy Ügpjy Åjqgy Égypj Öjgqy Åpgjy Éjgyp Ügyqj Åqjgy Égjqp Öygjp Åjgpq Égqyj Ügjyp Åpyqg Éjgqy Ögpyj Ågqjp Éyjqg Ügqpj Åjpgq Éqgyj",
  cta: "Réservez Égjpqy Ågjpqy Ügjpq Éjq",
};

/* One unbroken word per role, at the schema limits. An earlier builder drew the
   subheadline 604px past its column; another shrank the headline to
   4px instead. Both are wrong; the word must break at a readable size,
   with a fault. */
export const LONG_WORDS = {
  ...WORST_CASE,
  headline:
    "Supercalifragilisticexpialidociousantidisestablishmentarianismpastries",
  subheadline:
    "Pneumonoultramicroscopicsilicovolcanoconiosisfreecroissantsandpainauchocolatbakedfreshdailyatdawnforeveryoneinlekkiphaseoneandbeyondtoday!",
  cta: "Reservewholeboxfortheweekendnow!",
};

/* Wide capitals in long runs: the widest Latin text per character. */
export const CAPITALS = {
  ...WORST_CASE,
  headline: `${Array(6).fill("WWWWWWWWWW").join(" ")} WWW`,
  subheadline: Array(14).fill("WWWWWWWWW").join(" ").slice(0, 140),
  cta: "WWWWWWWWWW WWWWWWWWWW WWWWWWWWWW",
};

/* Digits, currency and quotation marks: no spaces to break at in the
   headline, and quotes Chromium and satori once broke beside differently. */
export const PUNCTUATION = {
  ...WORST_CASE,
  headline: "08035550142080355501420803555014208035550142—₦25,000,000.00!!!???",
  subheadline:
    "₦1,250,000 · ₦2,500,000 · ₦5,000,000 — 50%/75%/100% OFF «CROISSANTS» „PAIN“ ‘AU’ “CHOCOLAT” …… ——— ¡¿ÅÉÜ?! ẄẄẄẄ",
  cta: "₦25,000 → ORDER NOW!!!",
};

for (const [name, copy] of Object.entries({
  OVERSHOOT,
  LONG_WORDS,
  CAPITALS,
  PUNCTUATION,
})) {
  if (
    copy.headline.length > 70 ||
    copy.subheadline.length > 140 ||
    copy.cta.length > 32
  ) {
    throw new Error(`${name} copy must sit within the schema limits`);
  }
}

/** `text` cut to at most `max` UTF-16 units without splitting a character,
 *  which is how the schema counts. */
const clamp = (text: string, max: number) => {
  let out = "";
  for (const char of Array.from(text)) {
    if ((out + char).length > max) break;
    out += char;
  }
  return out;
};

/* Copy the bundled faces do not cover, which next/og draws in fallback
   faces (Twemoji, Noto) no local metrics table knows, and Vietnamese, whose
   stacked capitals reach further above the cap height than Å or É. */
export const SCRIPTS = {
  emoji: {
    ...WORST_CASE,
    headline: clamp(
      "🥐🥐🥐 Fresh croissants 🥐🥐🥐 baked before sunrise 🔥🔥🔥 grab yours now 🎉🎉",
      70,
    ),
    subheadline: clamp(
      "🥐 Flaky 🧈 buttery ☕ warm. Come in early 🌅 for the first batch 🥐🥐🥐 of the day. Order ahead 📱 and skip the queue every morning 🌞🌞🌞",
      140,
    ),
    cta: clamp("🛒 Order now 🥐🥐🥐 pickup 🎉", 32),
  },
  /* Sequences: ZWJ families and professions, flags, skin tones, keycaps.
     Each is one picture in satori and has to be one in the browser too. */
  emojiSequences: {
    ...WORST_CASE,
    headline: clamp(
      "👨‍👩‍👧‍👦 Family box 🇳🇬🇳🇬 👍🏾👍🏿 1️⃣ deal 🧑🏽‍🍳 baked 🏳️‍🌈 today",
      70,
    ),
    subheadline: clamp(
      "👩🏾‍🍳👨🏿‍🍳 bake 🥐 at dawn 🇳🇬 for every 👨‍👩‍👧‍👦 in Lekki 🏖️ 👍🏾 order 1️⃣2️⃣ boxes 🧑🏽‍🤝‍🧑🏿 share ❤️‍🔥 now 🫶🏾🫶🏾 💯",
      140,
    ),
    cta: clamp("🛒👨‍👩‍👧‍👦🇳🇬 Order 👍🏾", 32),
  },
  /* Symbols that are text by default and pictures with U+FE0F, keycaps on
     every base, and the subdivision flags: round 3's editor drew this
     subheadline 18px wider than its box in split-left. */
  emojiSymbols: {
    ...WORST_CASE,
    headline: clamp(
      "🏴\u{E0067}\u{E0062}\u{E0073}\u{E0063}\u{E0074}\u{E007F} Scotland 🏴\u{E0067}\u{E0062}\u{E0077}\u{E006C}\u{E0073}\u{E007F} Wales 👩🏽‍❤️‍💋‍👨🏿 love 🧑🏾‍🦯‍➡️ walk",
      70,
    ),
    subheadline: clamp(
      "#️⃣ *️⃣ 0️⃣ 9️⃣ ©️ ®️ ™️ ↔️ ⬆️ ⤴️ 〰️ 〽️ ㊗️ ㊙️ ‼️ ⁉️ ℹ️ Ⓜ️ ▶️ ◀️ ☀️ ☎️ ✔️ ✳️",
      140,
    ),
    cta: clamp("🇳🇬 Order 🇬🇭 now 🇰🇪", 32),
  },
  cjk: {
    ...WORST_CASE,
    headline: clamp(
      "焼きたてのクロワッサンを毎朝お届けします。週末限定のペストリーボックスが帰ってきました。今すぐご予約ください。",
      70,
    ),
    subheadline: clamp(
      "毎朝夜明け前に焼き上げるバタークロワッサン、パン・オ・ショコラ、アーモンドツイスト。発酵バターで一晩かけて手作業で折り込んだ生地を使用しています。早めにお越しいただくと、その日最初の焼きたてをお楽しみいただけます。",
      140,
    ),
    cta: clamp("今すぐ週末ボックスを予約する。店頭受け取りのみ。", 32),
  },
  /* Precomposed capitals with two marks stacked (Ǻ, Ȫ, Ẩ). Measured in one
     unspaced probe they drew in another face than the copy's words, 5px
     shorter, and the headline spilled 4px above its box at 16:9. */
  stackedLatin: {
    ...WORST_CASE,
    headline: "ǺǼǾȪȬȰ ḈṎṌṐṒḜǗǙǛ ẤẦẨẪẬẮẰẲẴẶ ẾỀỂỄỆ",
    subheadline:
      "Ǻ Ǽ Ǿ Ȫ Ȭ Ȱ Ḉ Ṏ Ṍ Ṑ Ṓ Ḝ Ǘ Ǚ Ǜ Ấ Ầ Ẩ Ẫ Ậ Ắ Ằ Ẳ Ẵ Ặ Ế Ề Ể Ễ Ệ Ố Ồ Ổ Ỗ Ộ Ớ Ờ Ở Ỡ Ợ Ứ Ừ Ử Ữ Ự",
    cta: "ẪỄỖẶẬ ǺǼǾȪȬ",
  },
  vietnamese: {
    ...WORST_CASE,
    headline: clamp(
      "ẪỄỖẶẬ ỖNG BÀ ẤM ÁP Ỹ Ỷ ỢỪỮ ẶC BIỆT BÁNH MÌ NƯỚNG GIÒN RỤM ĐẶT NGAY",
      70,
    ),
    subheadline: clamp(
      "Bánh sừng bò Ặc Biệt, ỗ bánh mì Ỗng Bà Ấm Áp nướng giòn mỗi sáng. Ẫm thực Ữ Ừ Ợ Ỷ Ỹ Ễ Ẫ Ỗ Ặ Ậ Ấ Ầ Ẩ Ắ Ằ Ẳ Ẵ Ế Ề Ể Ố Ồ Ổ Ớ Ờ Ở Ỡ Ứ Ừ Ử Ữ Ự gặp",
      140,
    ),
    cta: clamp("ĐẶT HÀNG NGAY ỖNG BÀ ẪỄỖẶẬ", 32),
  },
};

/* Copy the renderer cannot draw correctly, each refused by text-safety.ts
   with the fault named. */
export const REFUSED_COPY = {
  arabic: [
    "كرواسون طازج يخبز قبل شروق الشمس كل صباح",
    "TEXT_SCRIPT_UNSUPPORTED",
  ],
  hebrew: ["קרואסונים טריים נאפים לפני הזריחה", "TEXT_SCRIPT_UNSUPPORTED"],
  devanagari: ["ताज़ा क्रोइसां, अभी ऑर्डर करें", "TEXT_SCRIPT_UNSUPPORTED"],
  thai: ["ครัวซองต์สดใหม่ น้ำ ปั้น", "TEXT_SCRIPT_UNSUPPORTED"],
  khmer: ["នំក្រូសង់ស្រស់ៗ", "TEXT_SCRIPT_UNSUPPORTED"],
  armenian: ["Թարմ կրուասաններ ամեն առավոտ", "TEXT_SCRIPT_UNSUPPORTED"],
  georgian: ["ახალი კრუასანები ყოველ დილით", "TEXT_SCRIPT_UNSUPPORTED"],
  greekPolytonic: ["Ἀρχὴ ἥμισυ παντός", "TEXT_SCRIPT_UNSUPPORTED"],
  yoruba: ["Ọ̀rọ̀ ẹ̀kọ́ fún gbogbo ènìyàn", "TEXT_ACCENT_UNSUPPORTED"],
  zalgo: ["Ẕ̷̢̛͓̳̦͍̞̓̍͛ạ̶̛̞̖̫̺̓͒͑͝l̸̢̰̼̺͒̈́̾g̵̡̛̱̘̈́̃̓ọ̴̡͚̺̊͗̕ fresh croissants", "TEXT_CLUSTER_TOO_COMPLEX"],
  bidiOverride: ["Fresh \u202Esnossiorc\u202C today", "TEXT_CONTROL_CHARACTER"],
} as const;
