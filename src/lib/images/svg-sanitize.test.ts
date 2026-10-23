// @vitest-environment node
import { SaxesParser } from "saxes";
import sharp from "sharp";
import { beforeAll, describe, expect, it } from "vitest";
import {
  hostileSvgLogos,
  paletteCrashPng,
  svgLogo,
} from "./hostile-svg-fixtures";
import { buildJpeg } from "./image-fixtures";
import { svgIntrinsicRatio } from "./rasterize";
import {
  MAX_SVG_INPUT_BYTES,
  sanitizeSvg,
  UnsafeSvgError,
  type UnsafeSvgReason,
} from "./svg-sanitize";

const text = (svg: string) => new TextEncoder().encode(svg);
const decoded = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
const sanitised = async (svg: string) =>
  decoded((await sanitizeSvg(text(svg))).bytes);

async function refusal(svg: string | Uint8Array): Promise<UnsafeSvgError> {
  const input = typeof svg === "string" ? text(svg) : svg;
  const err = await sanitizeSvg(input).catch((e: unknown) => e);
  if (!(err instanceof UnsafeSvgError)) {
    throw new Error(`expected an UnsafeSvgError, got ${String(err)}`);
  }
  return err;
}

/* Every element and attribute, in order, as a strict parser reads them. */
function structure(svg: string): string[] {
  const seen: string[] = [];
  const parser = new SaxesParser({ xmlns: true });
  parser.on("opentag", (tag) => {
    seen.push(tag.name);
    for (const attr of Object.values(tag.attributes)) {
      seen.push(`${attr.name}=${attr.value}`);
    }
  });
  parser.on("text", (t) => {
    if (t.trim()) seen.push(`text:${t}`);
  });
  parser.write(svg).close();
  return seen;
}

const dataUri = (type: string, bytes: Uint8Array) =>
  `data:${type};base64,${Buffer.from(bytes).toString("base64")}`;

const hrefOf = (svg: string) => /href="([^"]*)"/.exec(svg)?.[1] ?? "";

describe("sanitizeSvg keeps what a logo is made of", () => {
  const LOGO = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 300 100">
  <defs>
    <linearGradient id="g"><stop offset="0" stop-color="#f97316"/><stop offset="1" stop-color="#0f172a"/></linearGradient>
    <path id="mark" d="M10 10 L90 10 L50 90 Z"/>
    <clipPath id="c"><rect width="300" height="100"/></clipPath>
  </defs>
  <style>.word { fill: url(#g); font: 700 40px sans-serif; } .a > .b { opacity: .5 }</style>
  <g clip-path="url(#c)">
    <use xlink:href="#mark" fill="url('#g')"/>
    <use href="#mark" x="100" style="fill: url( &quot;#g&quot; )"/>
    <text class="word" x="120" y="60">Acme &amp; Co</text>
  </g>
</svg>`;

  it("keeps every element, attribute and fragment reference", async () => {
    expect(structure(await sanitised(LOGO))).toEqual(structure(LOGO));
  });

  it("is stable: sanitising its own output changes nothing", async () => {
    const once = await sanitised(LOGO);
    expect(await sanitised(once)).toBe(once);
  });

  it("drops comments, processing instructions and the XML declaration", async () => {
    const out = await sanitised(
      `<?xml version="1.0" encoding="UTF-8"?><?xml-stylesheet href="https://evil.test/x.css"?><!-- Generator: Illustrator --><svg xmlns="http://www.w3.org/2000/svg"><!-- hi --><rect width="1" height="1"/></svg>`,
    );
    expect(out).toBe(
      '<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"></rect></svg>',
    );
  });

  it("keeps a CDATA style block as escaped text", async () => {
    const out = await sanitised(
      '<svg xmlns="http://www.w3.org/2000/svg"><style><![CDATA[.a > .b { fill: url(#g) }]]></style></svg>',
    );
    expect(out).toContain("<style>.a &gt; .b { fill: url(#g) }</style>");
  });

  it("escapes values so the renderer reads exactly what was checked", async () => {
    const out = await sanitised(
      '<svg xmlns="http://www.w3.org/2000/svg"><title a="&quot;&lt;&amp;&#10;">x &lt; y &amp; z</title></svg>',
    );
    expect(structure(out)).toEqual([
      "svg",
      "xmlns=http://www.w3.org/2000/svg",
      "title",
      'a="<&\n',
      "text:x < y & z",
    ]);
  });

  it("accepts an SVG with no namespace, writing it in the SVG namespace", async () => {
    await expect(
      sanitised('<svg viewBox="0 0 1 1"><rect width="1" height="1"/></svg>'),
    ).resolves.toBe(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><rect width="1" height="1"></rect></svg>',
    );
  });

  /* Round-5 corpus: satori failed a prefixed root as undrawable. */
  it("writes a prefixed SVG root and its children unprefixed", async () => {
    const out = await sanitised(
      '<s:svg xmlns:s="http://www.w3.org/2000/svg" viewBox="0 0 2 1"><s:rect width="1" height="1"/></s:svg>',
    );
    expect(out).toBe(
      '<svg xmlns="http://www.w3.org/2000/svg" xmlns:s="http://www.w3.org/2000/svg" viewBox="0 0 2 1"><rect width="1" height="1"></rect></svg>',
    );
    expect(svgIntrinsicRatio(text(out))).toBe(2);
  });

  it("keeps one default namespace, so no element leaves the SVG one", async () => {
    const out = await sanitised(
      '<svg xmlns="http://www.w3.org/2000/svg"><g><rect xmlns="http://www.w3.org/2000/svg"/></g></svg>',
    );
    expect(out).toBe(
      '<svg xmlns="http://www.w3.org/2000/svg"><g><rect></rect></g></svg>',
    );
  });
});

/* satori throws without a viewBox, and every drawing tool emits a
   width/height-only root. The sanitiser adds it, from the parsed root, so the
   loader, logo-colors and the upload route cannot disagree about it. */
describe("sanitizeSvg gives a width/height root its viewBox", () => {
  it.each([
    ['width="300px" height="100px"', "0 0 300 100"],
    ['width="300" height="100"', "0 0 300 100"],
    ['width="2in" height="1in"', "0 0 2 1"],
    ['width="1.5e2" height="50"', "0 0 150 50"],
  ])("adds one for %s", async (size, viewBox) => {
    const out = await sanitised(
      `<svg xmlns="http://www.w3.org/2000/svg" ${size}><rect/></svg>`,
    );
    expect(out).toContain(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" `,
    );
    expect(svgIntrinsicRatio(text(out))).toBeCloseTo(
      Number(viewBox.split(" ")[2]) / Number(viewBox.split(" ")[3]),
    );
  });

  it("leaves a root that declares one untouched", async () => {
    const out = await sanitised(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 4 2" width="400"/>',
    );
    expect(out.match(/viewBox/g)).toHaveLength(1);
    expect(out).toContain('viewBox="0 0 4 2"');
  });

  it("does not count a descendant viewBox as the root's", async () => {
    const out = await sanitised(
      '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="100"><symbol viewBox="0 0 1 1"/></svg>',
    );
    expect(out).toContain(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 100"',
    );
  });

  /* The regex this replaced patched the first "<svg" in the raw text, which
     can sit in a comment ahead of the root. */
  it("patches the root, not an <svg in a comment before it", async () => {
    const out = await sanitised(
      '<!-- <svg old --><svg xmlns="http://www.w3.org/2000/svg" width="30" height="10"/>',
    );
    expect(out).toBe(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 30 10" width="30" height="10"></svg>',
    );
  });

  it.each([
    ["nothing", ""],
    ["percentages", 'width="100%" height="100%"'],
    ["only a width", 'width="300"'],
    ["a zero side", 'width="0" height="10"'],
  ])("adds none for %s", async (_label, size) => {
    const out = await sanitised(
      `<svg xmlns="http://www.w3.org/2000/svg" ${size}></svg>`,
    );
    expect(out).not.toContain("viewBox");
  });

  it("is stable once added", async () => {
    const once = await sanitised(
      '<svg xmlns="http://www.w3.org/2000/svg" width="30" height="10"/>',
    );
    expect(await sanitised(once)).toBe(once);
  });
});

describe("sanitizeSvg re-encodes the rasters it keeps", () => {
  it("writes an embedded PNG back as one this process encoded", async () => {
    const png = await sharp({
      create: { width: 30, height: 20, channels: 4, background: "#f00a" },
    })
      .png({ progressive: true })
      .toBuffer();
    const out = await sanitised(
      svgLogo(
        `<image width="30" height="20" href="${dataUri("image/png", png)}"/>`,
      ),
    );
    const href = hrefOf(out.replace(/^.*<image/, "<image"));
    expect(href.startsWith("data:image/png;base64,")).toBe(true);
    const back = Buffer.from(href.split(",")[1], "base64");
    expect(back.equals(png)).toBe(false);
    expect(await sharp(back).metadata()).toMatchObject({
      format: "png",
      width: 30,
      height: 20,
      isProgressive: false,
    });
  });

  it("reads base64 broken across lines, as exporters write it", async () => {
    const jpeg = buildJpeg(16, 16).toString("base64");
    const wrapped = jpeg.replace(/(.{60})/g, "$1\n");
    const out = await sanitised(
      svgLogo(
        `<image width="16" height="16" xlink:href="data:image/jpeg;base64,${wrapped}"/>`,
      ),
    );
    expect(out).toMatch(/xlink:href="data:image\/jpeg;base64,[A-Za-z0-9+/=]+"/);
  });

  it("labels the raster by its bytes, not its claimed type", async () => {
    const out = await sanitised(
      svgLogo(`<image href="${dataUri("image/png", buildJpeg(8, 8))}"/>`),
    );
    expect(out).toContain('href="data:image/jpeg;base64,');
  });

  it("draws a JPEG whose end marker is missing, as a browser does", async () => {
    const noEnd = buildJpeg(16, 16).subarray(0, -2);
    await expect(
      sanitised(svgLogo(`<image href="${dataUri("image/jpeg", noEnd)}"/>`)),
    ).resolves.toContain("data:image/jpeg");
  });

  it("scales an embedded raster to a logo's size", async () => {
    const big = await sharp({
      create: { width: 3000, height: 1500, channels: 3, background: "#0a0" },
    })
      .png()
      .toBuffer();
    const out = await sanitised(
      svgLogo(`<image href="${dataUri("image/png", big)}"/>`),
    );
    const back = Buffer.from(hrefOf(out).split(",")[1], "base64");
    const meta = await sharp(back).metadata();
    expect([meta.width, meta.height]).toEqual([1024, 512]);
  });
});

describe("sanitizeSvg refuses what could reach outside or crash the renderer", () => {
  let hostile: Record<string, string>;
  beforeAll(async () => {
    hostile = hostileSvgLogos(await paletteCrashPng());
  });

  /* Round-3 critic B8: each of these killed the renderer process. */
  it.each([
    ["svg-embeds-plte-len4.svg", "embedded_image"],
    ["svg-embeds-plte-len4-href.svg", "embedded_image"],
    ["svg-embeds-svg-embeds-plte.svg", "external_reference"],
    ["svg-external-file-href.svg", "external_reference"],
    ["svg-xxe.svg", "doctype"],
  ] as const)("refuses the critic's %s (%s)", async (name, reason) => {
    expect((await refusal(hostile[name])).reason).toBe(reason);
  });

  it.each([
    [
      "an internal-subset DOCTYPE",
      '<!DOCTYPE svg [<!ENTITY a "b">]><svg xmlns="http://www.w3.org/2000/svg">&a;</svg>',
    ],
    [
      "a public DOCTYPE",
      '<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd"><svg xmlns="http://www.w3.org/2000/svg"/>',
    ],
    [
      "a billion-laughs entity",
      '<!DOCTYPE l [<!ENTITY a "aaaaaaaaaa"><!ENTITY b "&a;&a;&a;&a;&a;">]><svg xmlns="http://www.w3.org/2000/svg"><text>&b;</text></svg>',
    ],
  ])("refuses %s", async (_label, svg) => {
    expect((await refusal(svg)).reason).toBe("doctype");
  });

  it.each([
    ["an http image", '<image href="http://169.254.169.254/x"/>'],
    ["a protocol-relative image", '<image href="//evil.test/x.png"/>'],
    ["a relative file", '<image href="logo.png"/>'],
    ["a file: image", '<image xlink:href="file:///etc/passwd"/>'],
    ["a use into another file", '<use href="other.svg#mark"/>'],
    ["a link", '<a href="https://evil.test"><rect width="1" height="1"/></a>'],
    ["a javascript: link", '<a xlink:href="javascript:alert(1)"/>'],
    [
      "an feImage from a file",
      '<filter id="f"><feImage href="https://evil.test/x.png"/></filter>',
    ],
    [
      "an feImage carrying a PNG",
      `<filter id="f"><feImage href="${dataUri("image/png", buildJpeg(4, 4))}"/></filter>`,
    ],
    [
      "a nested SVG data URI",
      `<image href="data:image/svg+xml,${encodeURIComponent(svgLogo())}"/>`,
    ],
    [
      "a GIF data URI",
      '<image href="data:image/gif;base64,R0lGODlhAQABAAAAACw="/>',
    ],
    ["an HTML data URI", '<image href="data:text/html;base64,PGgxPg=="/>'],
    ["a percent-encoded PNG", '<image href="data:image/png,%89PNG"/>'],
    ["a pattern from a file", '<pattern href="https://evil.test/p.svg#p"/>'],
    [
      "an href in an unknown namespace",
      '<g xmlns:z="urn:z" z:href="https://evil.test"/>',
    ],
    [
      "XInclude",
      '<xi:include xmlns:xi="http://www.w3.org/2001/XInclude" href="#a" parse="text"/>',
    ],
    [
      "an animation that swaps an href",
      '<image href="#a"><set attributeName="href" to="https://evil.test/x.png"/></image>',
    ],
    [
      "an animate on xlink:href",
      '<image href="#a"><animate attributeName="xlink:href" values="https://evil.test/x.png"/></image>',
    ],
    [
      "a fill from another file",
      '<rect fill="url(https://evil.test/p.svg#g)"/>',
    ],
    ["a filter from another file", '<g filter="url(f.svg#f)"/>'],
    [
      "a style url to a file",
      "<rect style=\"fill: url(  'https://evil.test/g'  )\"/>",
    ],
    ["a CSS-escaped url(", '<rect style="fill: u\\72l(https://evil.test/g)"/>'],
    [
      "a style block url",
      "<style>rect { fill: url(https://evil.test/g) }</style>",
    ],
    [
      "a style block @import",
      '<style>@import "https://evil.test/x.css";</style>',
    ],
    ["a CDATA @import", "<style><![CDATA[@import url(#ok);]]></style>"],
    [
      "a CSS-escaped @import",
      '<style>@\\69mport "https://evil.test/x.css";</style>',
    ],
  ])("refuses %s", async (_label, body) => {
    expect((await refusal(svgLogo(body))).reason).toBe("external_reference");
  });

  it("refuses an embedded PNG the strict decoder rejects", async () => {
    const crash = await paletteCrashPng();
    const err = await refusal(
      svgLogo(`<image href="${dataUri("image/png", crash)}"/>`),
    );
    expect(err.reason).toBe("embedded_image");
    expect(err.cause).toBeInstanceOf(Error);
  });

  it.each([
    ["bytes that are not an image", dataUri("image/png", text("<svg/>"))],
    ["base64 with junk in it", "data:image/png;base64,iVBOR*w0KGgo="],
  ])("refuses an embedded image of %s", async (_label, href) => {
    expect((await refusal(svgLogo(`<image href="${href}"/>`))).reason).toBe(
      "embedded_image",
    );
  });

  it.each([
    ["HTML", "<html><body/></html>"],
    [
      "a non-SVG root in the SVG namespace",
      '<g xmlns="http://www.w3.org/2000/svg"/>',
    ],
    ["an svg root in another namespace", '<svg xmlns="urn:other"/>'],
    ["unclosed tags", '<svg xmlns="http://www.w3.org/2000/svg"><g>'],
    [
      "an undefined entity",
      '<svg xmlns="http://www.w3.org/2000/svg">&nbsp;</svg>',
    ],
    [
      "an unbound prefix",
      '<svg xmlns="http://www.w3.org/2000/svg"><x:g/></svg>',
    ],
    [
      "two roots",
      '<svg xmlns="http://www.w3.org/2000/svg"/><svg xmlns="http://www.w3.org/2000/svg"/>',
    ],
    ["nothing", ""],
  ])("refuses %s as not an SVG", async (_label, svg) => {
    expect((await refusal(svg)).reason).toBe("not_svg");
  });

  it("refuses bytes that are not UTF-8", async () => {
    const latin1 = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg"><text>caf\xe9</text></svg>',
      "latin1",
    );
    expect((await refusal(latin1)).reason).toBe("not_svg");
  });

  it("refuses a file over the logo upload cap before parsing it", async () => {
    const big = new Uint8Array(MAX_SVG_INPUT_BYTES + 1);
    expect((await refusal(big)).reason).toBe("too_large");
  });

  it("refuses more elements than a logo has", async () => {
    const svg = svgLogo("<g/>".repeat(50_001));
    expect((await refusal(svg)).reason).toBe("too_complex");
  });

  it("refuses more embedded images than a logo has", async () => {
    const image = `<image href="${dataUri("image/jpeg", buildJpeg(4, 4))}"/>`;
    expect((await refusal(svgLogo(image.repeat(9)))).reason).toBe(
      "too_complex",
    );
  });

  it("refuses output the renderer could not parse", async () => {
    const noise = Buffer.alloc(1024 * 1024 * 4);
    let seed = 3;
    for (let i = 0; i < noise.length; i += 1) {
      seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff;
      noise[i] = seed >>> 23;
    }
    const png = await sharp(noise, {
      raw: { width: 1024, height: 1024, channels: 4 },
    })
      .png()
      .toBuffer();
    const one = `<image href="${dataUri("image/png", png)}"/>`;
    expect((await refusal(svgLogo(one))).reason).toBe("too_large");
  }, 30_000);

  it.each<UnsafeSvgReason>([
    "not_svg",
    "too_large",
    "doctype",
    "external_reference",
    "embedded_image",
    "too_complex",
    "active_content",
    "bad_dimensions",
  ])("tells the uploader what to do about %s", (reason) => {
    expect(new UnsafeSvgError(reason, "detail").userMessage).toMatch(
      /^This SVG can't be used as a logo: [a-z].+\. Export it again as a plain SVG, or upload a PNG\.$/,
    );
  });
});

/* FEAT-033 round 5: the attack corpus (svg-attack-fixtures.ts) run through
   every logo path in child processes found these accepted at upload and then
   failing, slowly or silently, at render, or stored as uploaded with active
   content. */
/* Round-5 review: the upload route stores the sanitiser's output on a
   public bucket, so a browser opening the URL is a reader too. Anything only
   a browser would run is left out or refused, never passed through. */
describe("sanitizeSvg leaves out what only a browser would run", () => {
  const XHTML = "http://www.w3.org/1999/xhtml";

  it.each([
    [
      "foreignObject with HTML in it",
      `<foreignObject width="9" height="9"><div xmlns="${XHTML}"><img src="http://169.254.169.254/x"/></div></foreignObject>`,
    ],
    [
      "an XHTML iframe whose srcdoc carries a script",
      `<h:iframe xmlns:h="${XHTML}" srcdoc="&lt;script&gt;alert(1)&lt;/script&gt;"/>`,
    ],
    [
      "an XHTML meta refresh to javascript:",
      `<h:meta xmlns:h="${XHTML}" http-equiv="refresh" content="0;url=javascript:alert(1)"/>`,
    ],
    [
      "an HTML form posting to javascript:",
      `<foreignObject><form xmlns="${XHTML}" action="javascript:alert(1)"><button>x</button></form></foreignObject>`,
    ],
    [
      "an element in an unknown namespace",
      '<x:payload xmlns:x="urn:x"><x:a href="javascript:alert(1)">x</x:a></x:payload>',
    ],
  ])("leaves out %s, and everything inside it", async (_label, body) => {
    const out = await sanitised(svgLogo(body));
    expect(out).toBe(await sanitised(svgLogo()));
    expect(out).not.toMatch(
      /javascript|script|iframe|foreignObject|169\.254|srcdoc|refresh|form/i,
    );
  });

  /* Inkscape and Illustrator write editor state in their own namespaces.
     Refusing it would refuse most exported logos; it is dropped instead. */
  it("keeps an Inkscape export's drawing and drops its editor state", async () => {
    const out = await sanitised(
      '<svg xmlns="http://www.w3.org/2000/svg" xmlns:sodipodi="http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" viewBox="0 0 10 10"><sodipodi:namedview pagecolor="#fff"><inkscape:page x="0"/></sodipodi:namedview><g inkscape:label="Layer 1"><rect width="10" height="10"/></g></svg>',
    );
    expect(out).not.toContain("namedview");
    expect(out).toContain(
      '<g inkscape:label="Layer 1"><rect width="10" height="10"></rect></g>',
    );
  });

  it("does not let a dropped subtree register an id a <use> can reach", async () => {
    const out = await sanitised(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><foreignObject><g id="x"/></foreignObject><use href="#x"/></svg>`,
    );
    expect(out).toBe(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><use href="#x"></use></svg>',
    );
  });

  it.each([
    ["set", '<set attributeName="onclick" to="alert(1)"/>'],
    ["animate", '<animate attributeName="onload" values="alert(1)"/>'],
    ["animate, any case", '<animate attributeName=" OnMouseOver " to="x"/>'],
  ])("refuses %s that writes an event handler", async (_label, body) => {
    expect((await refusal(svgLogo(`<rect>${body}</rect>`))).reason).toBe(
      "active_content",
    );
  });

  it("still refuses a script inside a dropped subtree", async () => {
    const err = await refusal(
      svgLogo(
        `<foreignObject><h:script xmlns:h="${XHTML}">x</h:script></foreignObject>`,
      ),
    );
    expect(err.reason).toBe("active_content");
  });

  it("still bounds nesting inside a dropped subtree", async () => {
    const deep = `${'<x:g xmlns:x="urn:x">'.repeat(150)}${"</x:g>".repeat(150)}`;
    expect((await refusal(svgLogo(deep))).reason).toBe("too_complex");
  });
});

describe("sanitizeSvg refuses what the attack corpus found", () => {
  it.each([
    [
      "xml:base, which turns a fragment into a URL",
      '<g xml:base="http://169.254.169.254/"><use href="#d"/></g><circle id="d" r="1"/>',
    ],
  ])("refuses %s as an external reference", async (_label, body) => {
    expect((await refusal(svgLogo(body))).reason).toBe("external_reference");
  });

  it.each([
    ["a script element", "<script>fetch('http://x.test')</script>"],
    ["a CDATA script", "<script><![CDATA[1]]></script>"],
    ["an onload attribute", '<rect width="1" height="1" onload="fetch(1)"/>'],
    ["an upper-case handler", '<rect width="1" height="1" ONCLICK="x()"/>'],
  ])("refuses %s as active content", async (_label, body) => {
    expect((await refusal(svgLogo(body))).reason).toBe("active_content");
  });

  it("keeps attributes that only start like a handler's prefix", async () => {
    const out = await sanitised(
      svgLogo('<rect width="1" height="1" opacity="0.5"/>'),
    );
    expect(out).toContain('opacity="0.5"');
  });

  it("refuses nesting deeper than a logo has", async () => {
    const deep = `${"<g>".repeat(100)}<rect/>${"</g>".repeat(100)}`;
    expect((await refusal(svgLogo(deep))).reason).toBe("too_complex");
    const fine = `${"<g>".repeat(90)}<rect/>${"</g>".repeat(90)}`;
    await expect(sanitizeSvg(text(svgLogo(fine)))).resolves.toBeTruthy();
  });

  it("refuses an element or attribute name past what the renderer parses", async () => {
    expect((await refusal(svgLogo(`<${"a".repeat(1_001)}/>`))).reason).toBe(
      "too_complex",
    );
    expect(
      (await refusal(svgLogo(`<rect ${"a".repeat(1_001)}="1"/>`))).reason,
    ).toBe("too_complex");
  });

  /* Ten levels of ten: 10^10 drawn elements. librsvg spent 8.6 s per render
     reaching its own limit. */
  it("refuses <use> that expands exponentially", async () => {
    let defs = '<g id="l0"><rect width="1" height="1"/></g>';
    for (let level = 1; level <= 10; level += 1) {
      defs += `<g id="l${level}">${`<use href="#l${level - 1}"/>`.repeat(10)}</g>`;
    }
    const err = await refusal(
      svgLogo(`<defs>${defs}</defs><use href="#l10"/>`),
    );
    expect(err.reason).toBe("too_complex");
    expect(err.message).toMatch(/once <use> is expanded/);
  });

  it("refuses a <use> chain nested deeper than the renderer draws, without overflowing the stack", async () => {
    const groups = ['<g id="c0"><rect width="1" height="1"/></g>'];
    for (let i = 1; i < 20_000; i += 1) {
      groups.push(`<g id="c${i}"><use href="#c${i - 1}"/></g>`);
    }
    const svg = svgLogo(`<defs>${groups.join("")}</defs><use href="#c19999"/>`);
    expect((await refusal(svg)).reason).toBe("too_complex");
  });

  it("refuses a <use> cycle", async () => {
    const svg = svgLogo(
      '<g id="a"><use href="#b"/></g><g id="b"><use href="#a"/></g>',
    );
    expect((await refusal(svg)).message).toMatch(/cycle/);
  });

  it("keeps ordinary reuse: a mark used a hundred times", async () => {
    const svg = svgLogo(
      `<defs><g id="dot"><circle r="2"/><circle r="1" fill="#fff"/></g></defs>${'<use href="#dot"/>'.repeat(100)}`,
    );
    await expect(sanitizeSvg(text(svg))).resolves.toBeTruthy();
  });

  it.each([
    [
      "a viewBox with an exponent coordinate",
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1e308 1e308"/>',
    ],
    [
      "a width of a hundred million",
      '<svg xmlns="http://www.w3.org/2000/svg" width="100000000" height="1"/>',
    ],
    [
      "a 1:1,000,000 viewBox",
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1000000"/>',
    ],
    [
      "a 200:1 width and height",
      '<svg xmlns="http://www.w3.org/2000/svg" width="2000px" height="10px"/>',
    ],
  ])("refuses %s", async (_label, svg) => {
    expect((await refusal(svg)).reason).toBe("bad_dimensions");
  });

  it.each([
    [
      "a 20:1 wordmark",
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2000 100"/>',
    ],
    [
      "a percentage size",
      '<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" viewBox="0 0 10 10"/>',
    ],
    [
      "an Illustrator point size",
      '<svg xmlns="http://www.w3.org/2000/svg" width="612pt" height="792pt"/>',
    ],
    [
      "a viewBox with commas and an offset",
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="-5,-5,310,110"/>',
    ],
  ])("keeps %s", async (_label, svg) => {
    await expect(sanitizeSvg(text(svg))).resolves.toBeTruthy();
  });
});
