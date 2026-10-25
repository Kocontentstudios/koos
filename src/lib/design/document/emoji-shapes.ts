import type { DesignDocument, DesignElement } from "./schema";

/**
 * Test support: every shape an emoji cluster can take, each as a list of
 * distinct clusters, and designs that spread them over every run.
 *
 * next/og fetches one picture per distinct emoji grapheme, so the
 * per-design cap holds exactly when 25 clusters that are distinct as
 * strings are refused, whatever their shape. Four rounds of tests that
 * built a few shapes, or modelled next/og instead of asking it, each left
 * a miscount of some shape green; this lists the shapes instead.
 */

const TONES = ["\u{1F3FB}", "\u{1F3FC}", "\u{1F3FD}", "\u{1F3FE}", "\u{1F3FF}"];
const ZWJ = "‍";
const VS16 = "️";
const PEOPLE = [
  "\u{1F468}",
  "\u{1F469}",
  "\u{1F9D1}",
  "\u{1F466}",
  "\u{1F467}",
];
const TOOLS = Array.from("🍳🎓🎤🎨🏫🏭💻💼🔧🔬🚀🚒⚕⚖✈🌾🦯🦼🦽");
const PICTOGRAPHS = Array.from(
  "🌀🌁🌂🌃🌄🌅🌆🌇🌈🌉🌊🌋🌌🌍🌎🌏🌐🌑🌒🌓🌔🌕🌖🌗🌘🌙🌚🌛🌜🌝🌞🌟🌠🍇🍈🍉🍊🍋🍌🍍🍎🍏🍐",
);
const TEXT_DEFAULT = Array.from(
  "☀☁☂☃☄☎☑☘☝☠☢☣☦☪☮☯☸☹☺♀♂♟♠♣♥♦♨♻⚒⚔⚕⚖⚗⚙⚛⚜⚠✂✈✉✌✍✏✒✔✖✝✡✳✴❄❇❣❤",
);
const MODIFIER_BASES = Array.from("👍👋✋👌👏🙏💪👂👃👶🧒👦");
const KEYS = "0123456789#*".split("");
const FLAGS = [
  "NG",
  "GH",
  "KE",
  "ZA",
  "EG",
  "US",
  "GB",
  "FR",
  "DE",
  "IT",
  "ES",
  "PT",
  "BR",
  "AR",
  "MX",
  "CA",
  "JP",
  "KR",
  "CN",
  "IN",
  "AU",
  "NZ",
  "SE",
  "NO",
  "DK",
  "FI",
].map((code) =>
  Array.from(code, (letter) =>
    String.fromCodePoint(0x1f1e6 + letter.charCodeAt(0) - 65),
  ).join(""),
);
const SUBDIVISIONS = ["gbeng", "gbsct", "gbwls"].map(
  (tag) =>
    `\u{1F3F4}${Array.from(tag, (c) => String.fromCodePoint(0xe0000 + c.charCodeAt(0))).join("")}\u{E007F}`,
);

/** Shapes with fewer than 25 forms are filled to 25 with plain
 *  pictographs, so the shape itself must count for the cap to hold. */
function filled(forms: string[]): string[] {
  const fill = PICTOGRAPHS.filter((p) => !forms.includes(p));
  return [...forms, ...fill].slice(0, Math.max(forms.length, 30));
}

export const EMOJI_SHAPES: Record<string, string[]> = {
  "plain pictograph": PICTOGRAPHS,
  "text-default, bare": TEXT_DEFAULT,
  "text-default with VS16": TEXT_DEFAULT.map((p) => p + VS16),
  "both spellings of each": TEXT_DEFAULT.slice(0, 15).flatMap((p) => [
    p,
    p + VS16,
  ]),
  "skin tone on a modifier base": MODIFIER_BASES.flatMap((b) =>
    TONES.map((t) => b + t),
  ),
  "skin tone on any pictograph": PICTOGRAPHS.slice(0, 6).flatMap((p) =>
    TONES.map((t) => p + t),
  ),
  "person joined to a tool": PEOPLE.flatMap((p) =>
    TOOLS.map((t) => p + ZWJ + t),
  ),
  "toned person joined to a tool": TONES.flatMap((tone) =>
    TOOLS.slice(0, 6).map((t) => `👩${tone}${ZWJ}${t}`),
  ),
  "pictograph joined to a pictograph": PICTOGRAPHS.slice(0, 6).flatMap((a) =>
    PICTOGRAPHS.slice(6, 12).map((b) => a + ZWJ + b),
  ),
  "couple with a heart, both spellings": PEOPLE.slice(0, 3).flatMap((a) =>
    PEOPLE.slice(0, 3).flatMap((b) => [
      `${a}${ZWJ}❤${VS16}${ZWJ}${b}`,
      `${a}${ZWJ}❤${ZWJ}${b}`,
      `${a}${ZWJ}❤${VS16}${ZWJ}💋${ZWJ}${b}`,
    ]),
  ),
  "toned couple with a heart": TONES.flatMap((a) =>
    TONES.map((b) => `👩${a}${ZWJ}❤${VS16}${ZWJ}👨${b}`),
  ),
  "toned people holding hands": TONES.flatMap((a) =>
    TONES.map((b) => `🧑${a}${ZWJ}🤝${ZWJ}🧑${b}`),
  ).concat(TONES.map((a) => `👩${a}${ZWJ}🤝${ZWJ}👨`)),
  "family of three and four": [
    ...PEOPLE.flatMap((c) => [`👨${ZWJ}👩${ZWJ}${c}`]),
    ...PEOPLE.flatMap((c) =>
      PEOPLE.map((d) => `👨${ZWJ}👩${ZWJ}${c}${ZWJ}${d}`),
    ),
  ],
  "person with a gender sign, both spellings": PEOPLE.flatMap((p) =>
    ["♀", "♂"].flatMap((g) => [p + ZWJ + g + VS16, p + ZWJ + g]),
  ).concat(
    TONES.flatMap((t) => ["♀", "♂"].map((g) => `🧑${t}${ZWJ}${g}${VS16}`)),
  ),
  "person with hair": PEOPLE.flatMap((p) =>
    Array.from("🦰🦱🦲🦳").map((hair) => p + ZWJ + hair),
  ).concat(TONES.map((t) => `👩${t}${ZWJ}🦰`)),
  "keycap, both spellings": filled(
    KEYS.flatMap((k) => [`${k}${VS16}⃣`, `${k}⃣`]),
  ),
  flag: FLAGS,
  "subdivision flag": filled(SUBDIVISIONS),
};

const ROLES = [
  "headline",
  "headline",
  "subheadline",
  "subheadline",
  "cta",
  "cta",
  "footer",
  "body",
] as const;

export const SEPARATORS = [" ", "", "\n", "\r", "\r\n"] as const;

/** `clusters` dealt over all eight runs a design allows, joined by
 *  `separator`. */
export function designWith(
  clusters: string[],
  separator: string,
): DesignDocument {
  const runs = ROLES.map(() => [] as string[]);
  for (const [i, cluster] of clusters.entries()) {
    runs[i % runs.length].push(cluster);
  }
  return designOfRuns(runs.map((run) => run.join(separator)));
}

export function designOfRuns(texts: string[]): DesignDocument {
  const elements: DesignElement[] = texts.map((text, i) => ({
    id: `t${i}`,
    name: `t${i}`,
    x: 0,
    y: i * 160,
    width: 1080,
    height: 160,
    rotation: 0,
    opacity: 1,
    hidden: false,
    locked: false,
    type: "text",
    text: text || "a",
    role: ROLES[i % ROLES.length],
    font: "body",
    fontSize: 32,
    fontWeight: 400,
    lineHeight: 1.2,
    letterSpacing: 0,
    align: "left",
    italic: false,
    color: "#000000",
  }));
  return {
    version: 1,
    width: 1080,
    height: 1350,
    background: "#FFFFFF",
    elements,
  };
}

/** Pieces of an emoji that would attach to a neighbour once satori joins a
 *  design's emoji words: a tone, a flag letter, a joiner, the keycap mark,
 *  VS16 and a tag. */
export const LOOSE_PIECES: Record<string, string> = {
  "skin tone": "\u{1F3FD}",
  "skin tone with VS16": "\u{1F3FD}\uFE0F",
  "flag letter": "\u{1F1F3}",
  joiner: ZWJ,
  "keycap mark": "⃣",
  VS16: VS16,
  tag: "\u{E0067}",
};
