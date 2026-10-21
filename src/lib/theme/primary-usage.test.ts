import { describe, expect, it } from "vitest";
import { appScanPolicy } from "./primary-policy";
import { scanPrimaryUsage, splitVariants } from "./primary-usage";

const policy = appScanPolicy();
const scan = (snippet: string, file = "fixture.tsx") =>
  scanPrimaryUsage(file, snippet, policy);

/* Round 1's scan let 16 of these 21 through; a cold critic wrote them to find
   its blind spots (FEAT-033 ds-primary verdict, mutation-2 evasion probe).
   Five of the misses were live in src: the sidebar KO mark, the workspace
   avatar, the welcome-card KO mark, the light brand band and its badges. */
describe("the round-1 evasion probe is caught", () => {
  it.each([
    [
      "p01 a gradient with a brand stop under white",
      `<div className="bg-gradient-to-br from-primary to-[#0a6d9e] text-white">KO</div>`,
    ],
    [
      "p02 the retired hover hex as a fill",
      `<div className="bg-[#0f7eb8] text-white">retired hover hex</div>`,
    ],
    [
      "p03 a selection highlight",
      `<p className="selection:bg-primary selection:text-white">select me</p>`,
    ],
    [
      "p04 a placeholder in brand blue",
      `<input className="placeholder:text-primary" />`,
    ],
    [
      "p05 a file-input button",
      `<input type="file" className="file:bg-primary file:text-white" />`,
    ],
    [
      "p06 a 40% fill under white",
      `<div className="bg-primary/40 text-white">forty</div>`,
    ],
    ["p07 bg-ring", `<div className="bg-ring text-white">ring</div>`],
    [
      "p08 the ring token as an arbitrary value",
      `<div className="bg-[var(--ring)] text-white">ring var</div>`,
    ],
    [
      "p09 a typed arbitrary text colour",
      `<div className="text-[color:var(--primary)]">arb color</div>`,
    ],
    [
      "p10 a style object",
      `<div style={{ backgroundColor: "var(--primary)", color: "white" }}>style obj</div>`,
    ],
    [
      "p11 an SVG text fill attribute",
      `<svg><text fill="#138bc8">svg text</text></svg>`,
    ],
    [
      "p12 an SVG text fill class",
      `<svg><text className="fill-primary">svg fill class</text></svg>`,
    ],
    [
      "p13 an rgb() arbitrary fill",
      `<div className="bg-[rgb(19,139,200)] text-white">rgb</div>`,
    ],
    [
      "p14 a component label inside a fill",
      `<div className="bg-primary"><Button>child component label</Button></div>`,
    ],
    [
      "p15 a before: pseudo with content",
      `<div className="before:content-['New'] before:bg-primary before:text-white">x</div>`,
    ],
    [
      "p16 a literal brand hex as text, with alpha",
      `<span className="text-[#138BC8]/90">alpha</span>`,
    ],
    [
      "p17 the sidebar ring token",
      `<div className="bg-sidebar-ring text-white">sidebar ring</div>`,
    ],
  ])("%s", (_label, snippet) => {
    expect(scan(snippet)).not.toEqual([]);
  });

  it.each([
    [
      "p20 a background-image gradient under white",
      ".p20 { background-image: linear-gradient(135deg, var(--primary), #0a6d9e); color: #fff; }",
    ],
    [
      "p21 a band with its heading coloured by another rule",
      ".p21 { background: #0f7eb8; }\n.p21 h2 { color: #ffffff; }",
    ],
    [
      "p22 a descendant rule without semicolons",
      ".p22 { background: var(--primary) }\n.p22 span { color: white }",
    ],
    [
      "p23 one compact rule",
      ".p23 { background:var(--primary);color:var(--primary-foreground) }",
    ],
    ["an SVG text rule", ".chart text { fill: var(--primary); }"],
  ])("CSS: %s", (_label, css) => {
    expect(scan(css, "fixture.css")).not.toEqual([]);
  });
});

describe("each way the old pairing was written is still caught", () => {
  it.each([
    [
      "a button class list",
      `<button className="bg-primary text-white">Go</button>`,
    ],
    [
      "the cva default variant",
      `const v = { default: "bg-primary text-primary-foreground" };`,
    ],
    [
      "a hover-only fill",
      `<span className="group-hover:bg-primary group-hover:text-primary-foreground"><Arrow /></span>`,
    ],
    [
      "a brand mark whose text is a child",
      `<div className="bg-primary"><span className="text-white">KO</span></div>`,
    ],
    [
      "a brand mark with bare text",
      `<div className="size-7 bg-primary">KO</div>`,
    ],
    [
      "a conditional fill with the label colour in another piece",
      `<div className={\`size-7 \${isUser ? "bg-surface-2" : "bg-primary"} text-white\`}>{label}</div>`,
    ],
    [
      "an icon button",
      `<button className="bg-primary"><Send className="text-white" /></button>`,
    ],
    [
      "an arbitrary-value fill",
      `<b className="bg-[var(--primary)] text-[var(--primary-foreground)]">1</b>`,
    ],
    [
      "an inline style",
      `<button style={{ background: "#138bc8", color: "#ffffff" }}>Try again</button>`,
    ],
    [
      "an email button",
      'const html = `<a style="display:inline-block;background:#138bc8;color:#ffffff">Verify</a>`;',
    ],
    ["an email link", 'const html = `<a style="color:#138bc8">Open</a>`;'],
    [
      "primary as text",
      `<a className="text-primary hover:underline">Forgot?</a>`,
    ],
    [
      "primary as text behind a variant",
      `<a className="hover:text-primary">Edit</a>`,
    ],
    [
      "a style-object text colour",
      `<span style={{ color: "var(--primary)" }}>Live</span>`,
    ],
    [
      "a retired hover token",
      `<button className="hover:bg-[var(--primary-hover)]" />`,
    ],
    [
      "the old badge's 80% hover fill",
      `const v = "text-primary-foreground [a]:hover:bg-primary/80";`,
    ],
    [
      "a retired hex anywhere, even on a bar",
      `<div className="h-1 bg-[#0a6d9e]" />`,
    ],
    [
      "a fill gradient whose far stop is too light for white",
      `<div className="bg-gradient-to-br from-primary-fill to-[#7c5cff] text-white">Q</div>`,
    ],
    [
      "a fill gradient with a stop that cannot be measured",
      `<div className="bg-gradient-to-br from-primary-fill to-violet-500 text-white">Q</div>`,
    ],
    [
      "a fill token at partial alpha under white",
      `<div className="bg-primary-fill/60 text-white">Go</div>`,
    ],
    [
      "dark text on the fill",
      `<div className="bg-primary-fill text-foreground">Go</div>`,
    ],
    [
      "muted text on a brand tint (fails in dark)",
      `<div className="bg-[var(--accent-glow)]"><span className="text-[var(--text-muted)]">hint</span></div>`,
    ],
    [
      "the pale status blue on a tint (fails in light)",
      `<span className="bg-[rgba(19,139,200,0.15)] text-[#85B7EB]">Draft</span>`,
    ],
    [
      "a text token dimmed with alpha",
      `<a className="text-primary-text/70">Edit</a>`,
    ],
    [
      "a Tailwind v4 var shorthand",
      `<div className="bg-(--primary) text-white">v4</div>`,
    ],
  ])("%s", (_label, snippet) => {
    expect(scan(snippet)).not.toEqual([]);
  });

  it.each([
    [".x { background: var(--primary); color: white; }"],
    [".x:hover { background: var(--primary-hover); }"],
    [".x { color: var(--primary); }"],
    [".x { color: #0f7eb8; }"],
    [
      ".x { background: var(--primary-fill); }\n.x .badge { background: rgba(255, 255, 255, 0.2); color: #fff; }",
    ],
    [
      ':root[data-theme="light"] .x { background: var(--primary); }\n:root[data-theme="light"] .x :is(h2, p) { color: #ffffff; }',
    ],
    [
      ".x span { background: linear-gradient(135deg, var(--primary), #85B7EB); -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent; }",
    ],
    [".x::after { content: 'New'; background: var(--primary); color: #fff; }"],
    [
      ".avatar { background: linear-gradient(135deg, var(--primary-fill), #A855F7); color: white; }",
    ],
  ])("CSS: %s", (css) => {
    expect(scan(css, "fixture.css")).not.toEqual([]);
  });
});

describe("what the brand blue may still do is left alone", () => {
  it.each([
    [
      "the fill tokens under the foreground",
      `<button className="bg-primary-fill text-primary-foreground hover:bg-primary-fill-hover active:bg-primary-fill-active">Go</button>`,
    ],
    [
      "the text tokens",
      `<a className="text-primary-text hover:text-primary-text-hover">Forgot?</a>`,
    ],
    ["a dot", `<span className="size-1.5 rounded-full bg-primary" />`],
    [
      "a progress bar",
      `<div className="h-1 bg-primary" style={{ width: "40%" }} />`,
    ],
    [
      "a tint behind brand-blue text",
      `<span className="bg-primary/15 text-primary-text">3</span>`,
    ],
    [
      "a 20% rgba tint behind brand-blue text",
      `<span className="bg-[rgba(19,139,200,0.2)] text-primary-text">3</span>`,
    ],
    [
      "the status pair on its tint",
      `<span className="bg-[var(--status-progress-bg)] text-[var(--status-progress-fg)]">Live</span>`,
    ],
    [
      "a ring and a border",
      `<div className="ring-2 ring-primary border-primary">x</div>`,
    ],
    [
      "the foreground token on its own",
      `<span className="text-primary-foreground" />`,
    ],
    [
      "a theme-light variant with a colon inside brackets",
      `<i className="[:root[data-theme=light]_&]:text-primary-text" />`,
    ],
    [
      "a pseudo-element indicator bar",
      `<a className="text-white before:absolute before:bg-primary">Calendar</a>`,
    ],
    [
      "a before: bar with empty content",
      `<a className="text-white before:content-[''] before:bg-primary">Calendar</a>`,
    ],
    [
      "a fill gradient whose every stop clears 4.5 under white",
      `<div className="bg-gradient-to-br from-primary-fill to-[#6e4aff] text-white">Q</div>`,
    ],
    [
      "a gradient between fill tokens",
      `<div className="bg-gradient-to-br from-primary-fill to-primary-fill-active text-white">KO</div>`,
    ],
    [
      "a faint card wash behind normal text",
      `<div className="bg-gradient-to-r from-primary/10 to-[#7c5cff]/10"><p className="text-foreground">Team</p></div>`,
    ],
    [
      "an SVG icon filled with the brand blue",
      `<svg><path className="fill-primary" d="M0 0" /></svg>`,
    ],
    [
      "opposite branches of one conditional",
      `<span className={active ? "bg-primary-fill text-primary-foreground" : "bg-[rgba(19,139,200,0.15)] text-primary-text"}><Icon /></span>`,
    ],
    [
      "secondary text on a brand tint",
      `<div className="bg-[var(--accent-glow)]"><span className="text-[var(--text-secondary)]">hint</span></div>`,
    ],
    [
      "a muted hint that leaves the tinted state",
      `<div className={active ? "bg-[var(--accent-glow)]" : "hover:bg-[var(--hover)]"}><span className={active ? "text-[var(--text-secondary)]" : "text-[var(--text-muted)]"}>hint</span></div>`,
    ],
    [
      "the brand value as a colour-picker default",
      `const FALLBACK = "#138BC8";`,
    ],
  ])("%s", (_label, snippet) => {
    expect(scan(snippet)).toEqual([]);
  });

  it.each([
    [
      "borders and outlines",
      ".x { border: 1px solid var(--primary); border-color: var(--primary); outline: 2px solid var(--primary); }",
    ],
    ["an SVG icon fill", ".p24 { fill: var(--primary); }"],
    [
      "a band on the fill with white text inside",
      ':root[data-theme="light"] .band { background: var(--primary-fill); }\n:root[data-theme="light"] .band .info :is(h2, p, span) { color: #ffffff; }',
    ],
    [
      "a badge with its own solid fill inside a band",
      ".band { background: var(--primary-fill); }\n.band .badge { background: var(--primary-fill-active); color: #ffffff; }",
    ],
    [
      "gradient text between the text tokens",
      ".x span { background: linear-gradient(135deg, var(--primary-text), var(--primary-text-hover)); -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent; }",
    ],
    [
      "a decorative orb",
      ".orb { background: var(--primary); filter: blur(80px); }",
    ],
    [
      "a bar gradient",
      ".bar { background: linear-gradient(90deg, var(--primary), transparent); }",
    ],
  ])("CSS: %s", (_label, css) => {
    expect(scan(css, "fixture.css")).toEqual([]);
  });
});

describe("splitVariants", () => {
  it.each([
    ["group-hover:bg-primary", ["group-hover"], "bg-primary"],
    ["[a]:hover:bg-primary/80", ["[a]", "hover"], "bg-primary/80"],
    [
      "[:root[data-theme=light]_&]:text-primary-text",
      ["[:root[data-theme=light]_&]"],
      "text-primary-text",
    ],
    ["bg-[color:var(--x)]", [], "bg-[color:var(--x)]"],
  ])("%s", (token, variants, utility) => {
    expect(splitVariants(token)).toEqual({ variants, utility });
  });
});
