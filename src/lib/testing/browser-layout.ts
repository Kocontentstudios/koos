import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { type Browser, chromium } from "playwright";
import { compile } from "tailwindcss";

/**
 * Layout checks that jsdom cannot make (it has no layout): static markup is
 * styled with the app's real globals.css, compiled by Tailwind for exactly
 * the classes the markup uses, and measured in headless Chromium.
 */

const require = createRequire(import.meta.url);
const ROOT = process.cwd();
const FONTS = path.join(ROOT, "src/lib/design/render/fonts");

function stylesheetPath(id: string, base: string): string {
  if (id === "tailwindcss") return require.resolve("tailwindcss/index.css");
  if (id.startsWith("tailwindcss/")) return require.resolve(id);
  return path.resolve(base, id);
}

function classCandidates(html: string): string[] {
  const found = new Set<string>();
  for (const match of html.matchAll(/class="([^"]*)"/g)) {
    for (const token of match[1].split(/\s+/)) {
      if (token) found.add(token.replaceAll("&amp;", "&"));
    }
  }
  return [...found];
}

/* The body face is Montserrat via next/font; without the real metrics a
   label's width, and so whether a row overflows, would be a fallback's. */
function fontFaces(): string {
  const face = (file: string, weight: number) =>
    `@font-face{font-family:"Montserrat";font-weight:${weight};src:url(data:font/ttf;base64,${readFileSync(path.join(FONTS, file)).toString("base64")}) format("truetype")}`;
  return [
    face("body-regular.ttf", 400),
    face("body-semibold.ttf", 500),
    face("body-semibold.ttf", 600),
    ':root{--font-montserrat:"Montserrat";--font-bricolage:"Montserrat"}',
  ].join("\n");
}

export async function appCssFor(html: string): Promise<string> {
  const globals = path.join(ROOT, "src/app/globals.css");
  const compiler = await compile(readFileSync(globals, "utf8"), {
    base: path.dirname(globals),
    loadStylesheet: async (id, base) => {
      const file = stylesheetPath(id, base);
      return {
        path: file,
        base: path.dirname(file),
        content: readFileSync(file, "utf8"),
      };
    },
  });
  return `${fontFaces()}\n${compiler.build(classCandidates(html))}`;
}

export async function launchChromium(): Promise<Browser> {
  try {
    return await chromium.launch();
  } catch (err) {
    throw new Error(
      "Headless Chromium would not start. Install it with `pnpm exec playwright install --only-shell chromium`.",
      { cause: err },
    );
  }
}

export function pageHtml(body: string, css: string, theme: "light" | "dark") {
  return `<!doctype html><html data-theme="${theme}" class="${theme}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body>${body}</body></html>`;
}
