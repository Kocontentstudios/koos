/**
 * Document fixtures built at runtime.
 *
 * The Safety rule forbids committing binaries, and a base64 blob in a .ts file
 * is a binary wearing a costume — unreadable in review and unchangeable
 * without a generator. A .docx and a .pptx are both just zips of XML, so both
 * are assembled here from source we can read; the PDF is written out longhand.
 *
 * Test-only, but not in a .test.ts file: the route tests need them too.
 */

import { strToU8, zipSync } from "fflate";

function zip(files: Record<string, string>): Buffer {
  return Buffer.from(
    zipSync(
      Object.fromEntries(
        Object.entries(files).map(([path, xml]) => [path, strToU8(xml)]),
      ),
    ),
  );
}

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>`;

export function docxFixture(paragraphs: string[]): Buffer {
  const body = paragraphs
    .map((p) => `<w:p><w:r><w:t>${p}</w:t></w:r></w:p>`)
    .join("");
  return zip({
    "[Content_Types].xml": CONTENT_TYPES,
    "word/document.xml": `<?xml version="1.0" encoding="UTF-8"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:body>${body}</w:body></w:document>`,
  });
}

/** One entry per slide, each a list of text runs. */
export function pptxFixture(slides: string[][]): Buffer {
  const files: Record<string, string> = {
    "[Content_Types].xml": CONTENT_TYPES,
  };
  slides.forEach((runs, i) => {
    const shapes = runs
      .map(
        (t) =>
          `<p:sp><p:txBody><a:p><a:r><a:t>${t}</a:t></a:r></a:p></p:txBody></p:sp>`,
      )
      .join("");
    files[`ppt/slides/slide${i + 1}.xml`] = `<?xml version="1.0"?>
<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
       xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
<p:cSld><p:spTree>${shapes}</p:spTree></p:cSld></p:sld>`;
  });
  return zip(files);
}

/**
 * A minimal single-page PDF with an uncompressed text stream.
 *
 * Byte offsets in the xref table have to be exact, so they are measured from
 * the assembled body rather than written by hand — a hand-counted xref is
 * wrong the first time anyone edits a string above it.
 */
export function pdfFixture(lines: string[]): Buffer {
  const content = lines
    .map((line, i) => {
      const escaped = line.replace(/([\\()])/g, "\\$1");
      return `BT /F1 12 Tf 72 ${720 - i * 18} Td (${escaped}) Tj ET`;
    })
    .join("\n");

  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });

  const xrefStart = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    pdf += `${offset.toString().padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;

  return Buffer.from(pdf, "latin1");
}
