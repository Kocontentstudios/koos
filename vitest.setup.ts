import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";

// Files opting into `@vitest-environment node` (e.g. the satori/resvg render
// smoke test) still run this setup, so every DOM touch must be guarded.
const hasDom = typeof window !== "undefined";

// jsdom's localStorage persists across tests within a file; clear it so tests
// that read/write localStorage (e.g. draft-restore effects) don't leak state.
afterEach(() => {
  if (hasDom) localStorage.clear();
});

// jsdom doesn't implement scrollIntoView; stub it so components that call it
// (e.g. auto-scrolling message lists) don't throw in tests.
if (hasDom && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}
