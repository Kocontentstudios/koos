import { SaxesParser } from "saxes";

/**
 * Test helper: what in a stored SVG a browser opening its public URL could
 * run or fetch. Independent of svg-sanitize.ts on purpose, so the upload
 * route's stored bytes are judged by a second reader rather than by the
 * code that wrote them. Empty for an inert document.
 */
/* Read by a parser rather than a pattern, so text that merely spells
   markup is not mistaken for it. */
const SVG_NS = "http://www.w3.org/2000/svg";
const LOCAL_REFERENCE = /^(?:#|data:image\/(?:png|jpeg);base64,)/;
const REMOTE_CSS = /@import|url\(\s*["']?\s*(?!#)|javascript:/i;

export function browserActiveContent(bytes: Uint8Array): string[] {
  const found = new Set<string>();
  const parser = new SaxesParser({ xmlns: true });
  let inStyle = false;
  parser.on("doctype", () => found.add("doctype"));
  parser.on("processinginstruction", (pi) => found.add(`<?${pi.target}`));
  parser.on("opentag", (tag) => {
    if (tag.uri !== SVG_NS) found.add(`<${tag.name}> outside SVG`);
    if (/^(?:script|foreignObject|iframe|handler)$/i.test(tag.local)) {
      found.add(`<${tag.name}>`);
    }
    inStyle = tag.local === "style";
    for (const attr of Object.values(tag.attributes)) {
      if (attr.prefix === "xmlns" || attr.name === "xmlns") continue;
      if (/^on/i.test(attr.local)) found.add(attr.name);
      const isReference = attr.local === "href" || attr.local === "src";
      if (isReference && !LOCAL_REFERENCE.test(attr.value)) {
        found.add(`${attr.name}=${attr.value.slice(0, 40)}`);
      }
      if (!isReference && REMOTE_CSS.test(attr.value)) {
        found.add(`${attr.name}=${attr.value.slice(0, 40)}`);
      }
      if (
        attr.local === "attributeName" &&
        /^(?:on|.*href$)/i.test(attr.value.trim())
      ) {
        found.add(`animates ${attr.value}`);
      }
    }
  });
  parser.on("closetag", () => {
    inStyle = false;
  });
  const onText = (text: string) => {
    if (inStyle && REMOTE_CSS.test(text))
      found.add(`<style>${text.slice(0, 40)}`);
  };
  parser.on("text", onText);
  parser.on("cdata", onText);
  parser.write(new TextDecoder().decode(bytes)).close();
  return [...found];
}
