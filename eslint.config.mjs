import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Fas 2 (2026-09-30): the core reaches ee/ only through @ee/server, @ee/client and @ee/present, so it builds and
  // runs without ee/ (the community edition). ee/ itself and its tests may import anything.
  {
    files: ["**/*.{ts,tsx,mjs,cjs}"],
    ignores: ["ee/**"],
    rules: {
      "no-restricted-imports": ["error", {
        patterns: [{
          regex: "^(@/ee/|(\\.\\./)+ee/|@ee/(?!(server|client|present)$))",
          message: "The core may only reach ee/ through @ee/server, @ee/client or @ee/present (lib/extensions).",
        }],
      }],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "public/offline-editor.js", // Generated bundle; lint the TypeScript source instead.
    "tmp/**", // Git-ignored scratch material (QA evidence and one-off scripts).
  ]),
]);

export default eslintConfig;
