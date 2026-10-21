/**
 * Draws images through next/og, the production renderer, in a process of its
 * own. resvg aborts on some malformed images and an abort cannot be caught, so
 * the only safe way to ask "does this crash the renderer" is to let it crash
 * something disposable. Spawned by renderInChild (render-in-child.ts).
 *
 * Usage: node render-gate-child.mjs <dir>, where <dir>/manifest.json lists
 * { file, name, contentType }. Prints each name to stderr before drawing it,
 * so after an abort the last name printed is the culprit, then one JSON line
 * of verdicts to stdout.
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const { ImageResponse } = require("next/og");

const SIZE = 64;

async function render(dataUrl) {
  const children = dataUrl
    ? { type: "img", props: { src: dataUrl, width: SIZE, height: SIZE } }
    : undefined;
  const element = {
    type: "div",
    props: {
      style: { display: "flex", width: SIZE, height: SIZE, background: "#f00" },
      children,
    },
  };
  const response = new ImageResponse(element, { width: SIZE, height: SIZE });
  return Buffer.from(await response.arrayBuffer());
}

const dir = process.argv[2];
const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
const noImage = await render(null);
const verdicts = {};
for (const { file, name, contentType } of manifest) {
  process.stderr.write(`START ${name}\n`);
  const bytes = readFileSync(join(dir, file));
  try {
    const out = await render(
      `data:${contentType};base64,${bytes.toString("base64")}`,
    );
    verdicts[name] = out.equals(noImage) ? "empty" : "drawn";
  } catch (err) {
    verdicts[name] = `threw ${String(err).slice(0, 120)}`;
  }
}
process.stdout.write(`${JSON.stringify(verdicts)}\n`);
