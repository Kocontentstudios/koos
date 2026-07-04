import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";

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
