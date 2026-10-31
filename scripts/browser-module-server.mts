import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

/**
 * Serves a page and this repo's src/ modules to headless Chromium for the
 * browser evals, with types stripped by the TypeScript compiler and "@/"
 * mapped by an import map in the page, so nothing is bundled. `fixture`
 * answers /fixture/<name>.
 */

const ROOT = fileURLToPath(new URL("..", import.meta.url));

export const IMPORT_MAP =
  '<script type="importmap">{"imports":{"@/":"/src/"}}</script>';

function serveSource(path: string): string | null {
  const base = join(ROOT, path);
  for (const candidate of [base, `${base}.ts`]) {
    try {
      const text = readFileSync(candidate, "utf8");
      return ts.transpileModule(text, {
        compilerOptions: {
          module: ts.ModuleKind.ESNext,
          target: ts.ScriptTarget.ES2022,
        },
      }).outputText;
    } catch {}
  }
  return null;
}

export async function startModuleServer(
  page: string,
  fixture: (name: string) => Uint8Array | null,
): Promise<{ server: Server; url: string }> {
  const server = createServer((req, res) => {
    const url = decodeURIComponent(
      new URL(req.url ?? "/", "http://x").pathname,
    );
    if (url === "/") {
      res.writeHead(200, { "content-type": "text/html" }).end(page);
    } else if (url.startsWith("/fixture/")) {
      const bytes = fixture(url.slice("/fixture/".length));
      if (bytes === null) res.writeHead(404).end();
      else res.writeHead(200).end(bytes);
    } else if (url.startsWith("/src/")) {
      const js = serveSource(url.slice(1));
      if (js === null) res.writeHead(404).end();
      else res.writeHead(200, { "content-type": "text/javascript" }).end(js);
    } else {
      res.writeHead(404).end();
    }
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return { server, url: `http://127.0.0.1:${port}/` };
}
