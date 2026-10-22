// @vitest-environment node
import { describe, expect, it } from "vitest";
import { browserActiveContent } from "./browser-active-svg";

const svg = (body: string) =>
  new TextEncoder().encode(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1">${body}</svg>`,
  );

/* The upload corpus test passes when this finds nothing, so it must be shown
   to find each thing it looks for. */
describe("browserActiveContent", () => {
  it.each([
    ["a script", "<script>x</script>"],
    ["an event handler", '<rect onclick="x"/>'],
    ["foreignObject", "<foreignObject/>"],
    ["an XHTML element", '<h:iframe xmlns:h="http://www.w3.org/1999/xhtml"/>'],
    ["an external href", '<image href="https://x.test/a.png"/>'],
    [
      "an external xlink:href",
      '<use xmlns:l="http://www.w3.org/1999/xlink" l:href="a.svg#b"/>',
    ],
    ["a javascript: link", '<a href="javascript:x"/>'],
    ["a remote url() in an attribute", '<rect fill="url(https://x.test/#a)"/>'],
    ["an @import", "<style>@import 'a.css';</style>"],
    ["an animated handler", '<set attributeName="onclick" to="x"/>'],
    ["an animated href", '<set attributeName="xlink:href" to="x"/>'],
    ["an embedded SVG", '<image href="data:image/svg+xml;base64,AA=="/>'],
  ])("finds %s", (_label, body) => {
    expect(browserActiveContent(svg(body))).not.toEqual([]);
  });

  it("finds a processing instruction", () => {
    expect(
      browserActiveContent(
        new TextEncoder().encode(
          '<?xml-stylesheet href="a.css"?><svg xmlns="http://www.w3.org/2000/svg"/>',
        ),
      ),
    ).not.toEqual([]);
  });

  it.each([
    ["a fragment reference", '<use href="#a"/><rect id="a" fill="url(#g)"/>'],
    ["an embedded PNG", '<image href="data:image/png;base64,AA=="/>'],
    [
      "markup spelled as text",
      "<text>&lt;script&gt; onclick=&quot;x&quot;</text>",
    ],
    [
      "an attribute that only starts like a handler's prefix",
      '<rect opacity="1"/>',
    ],
  ])("passes %s", (_label, body) => {
    expect(browserActiveContent(svg(body))).toEqual([]);
  });
});
