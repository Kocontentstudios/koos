import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// Point to the main project's node_modules to avoid duplicate React instances
const mainNodeModules = "/home/oluwaseyi/dev247/project/koos/node_modules";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
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
