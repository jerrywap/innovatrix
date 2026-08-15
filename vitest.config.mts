import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    coverage: {
      reporter: ["text", "html"],
      // §19.5: a floor on the code that holds business rules, not a global
      // number that rewards testing trivia.
      include: ["src/lib/**", "src/services/**", "src/config/**"],
    },
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // `server-only` throws on import outside an RSC graph. Vitest runs in
      // plain Node, so point it at the package's own no-op entry — the same
      // file the "react-server" condition resolves to.
      "server-only": fileURLToPath(
        new URL("./node_modules/server-only/empty.js", import.meta.url),
      ),
    },
  },
});
