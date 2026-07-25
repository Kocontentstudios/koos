import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

// Load .env file for database tests
const envPath = path.resolve(__dirname, ".env");
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, "utf-8");
  envContent.split("\n").forEach((line) => {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith("#")) {
      const [key, ...valueParts] = trimmed.split("=");
      if (key) {
        process.env[key] = valueParts.join("=");
      }
    }
  });
}

// jsdom's localStorage persists across tests within a file; clear it so tests
// that read/write localStorage (e.g. draft-restore effects) don't leak state.
afterEach(() => {
  localStorage.clear();
});

// jsdom doesn't implement scrollIntoView; stub it so components that call it
// (e.g. auto-scrolling message lists) don't throw in tests.
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}
