import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// Point to this repo's node_modules to avoid duplicate React instances
const mainNodeModules = resolve(__dirname, "node_modules");

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    include: ["src/**/*.{test,spec}.{ts,tsx}", "scripts/**/*.test.mjs"],
    /* The 5s default is a timer on CPU contention, not on the test.
     *
     * The suite rasterises real designs through satori and resvg — a handful
     * of *.smoke.test.ts files saturate every core for seconds at a time — and
     * a jsdom test that normally finishes in 200ms then exceeds the default
     * while merely waiting for a slice. The symptom is a different set of
     * unrelated UI tests failing on each run, which is how a suite stops being
     * trusted. A genuinely stuck test still fails; it just fails honestly. */
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "./src"),
      react: resolve(mainNodeModules, "react"),
      "react-dom": resolve(mainNodeModules, "react-dom"),
      "lucide-react": resolve(mainNodeModules, "lucide-react"),
    },
    dedupe: ["react", "react-dom", "lucide-react"],
  },
});
