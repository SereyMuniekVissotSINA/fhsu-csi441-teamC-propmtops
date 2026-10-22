import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  // The smoke test drives a running server over HTTP, where a response body is
  // untyped by nature and gets asserted on at each call site. Restating every
  // endpoint's shape here would duplicate the route schemas to satisfy a rule
  // that is earning nothing in a throwaway script.
  {
    files: ["scripts/**/*.ts"],
    rules: { "@typescript-eslint/no-explicit-any": "off" },
  },
]);

export default eslintConfig;
