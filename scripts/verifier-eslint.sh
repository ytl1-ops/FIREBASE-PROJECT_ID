#!/bin/sh
# Analyse ESLint (sécurité, hooks React, accessibilité) selon les recommandations ECC.
# Installée dans un dossier isolé : typescript-eslint ne prend pas encore en charge TypeScript 7.
set -eu
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TOOLS="${TMPDIR:-/tmp}/monmeeting-eslint"
mkdir -p "$TOOLS" && cd "$TOOLS"
[ -f package.json ] || npm init -y >/dev/null
npm i -s eslint@9 @eslint/js@9 typescript@5.9 typescript-eslint eslint-plugin-react-hooks \
  eslint-plugin-security eslint-plugin-jsx-a11y globals
cat > eslint.config.mjs <<CONF
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import security from "eslint-plugin-security";
import jsxA11y from "eslint-plugin-jsx-a11y";
import globals from "globals";
export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  security.configs.recommended,
  jsxA11y.flatConfigs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
      parserOptions: { project: "$ROOT/tsconfig.json", tsconfigRootDir: "$ROOT" },
    },
    plugins: { "react-hooks": reactHooks },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": ["error", { checksVoidReturn: { attributes: false } }],
      eqeqeq: "error",
    },
  },
  { files: ["public/**/*.js"], ...tseslint.configs.disableTypeChecked, languageOptions: { globals: { ...globals.serviceworker } } },
);
CONF
cd "$ROOT" && "$TOOLS/node_modules/.bin/eslint" -c "$TOOLS/eslint.config.mjs" src server shared public/sw.js
