import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist", "node_modules"] },
  js.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    extends: [...tseslint.configs.strictTypeChecked],
    languageOptions: {
      parserOptions: { project: ["./tsconfig.eslint.json"], tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      // `any` hides exactly the API-shape mistakes this client must not make.
      "@typescript-eslint/no-explicit-any": "error",
    },
  },
  {
    // A read that failed is drawn by the shared `Unread` alone — a
    // warning's plate and «Спробувати ще раз» — never a bare alert, which
    // is a refusal's red (audit after stage 2, frame P1-2). It sees
    // `role="alert"` written as a string holding a `readText(` call at any
    // depth; not `role={"alert"}`, nor a text read into a name first.
    // A status is the shared `Sticker` alone, its glyph brought by its
    // meaning (frame P1-5): no class `sticker` or `badge` written in a
    // `className`, as a string or in a template. Each of the two shared
    // components is let off both: neither draws the other's.
    files: ["src/**/*.tsx"],
    ignores: ["src/shared/Unread.tsx", "src/shared/Sticker.tsx"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector:
            'JSXElement:has(> JSXOpeningElement:has(JSXAttribute[name.name="role"][value.value="alert"])):has(CallExpression[callee.name="readText"])',
          message:
            "A read that failed is the shared Unread's plate, never a bare alert (frame P1-2).",
        },
        {
          selector:
            'JSXAttribute[name.name="className"] Literal[value=/(^|\\s)(sticker|badge)(\\s|$)/]',
          message:
            "A status is the shared Sticker, its glyph brought by its tone (frame P1-5).",
        },
        {
          selector:
            'JSXAttribute[name.name="className"] TemplateElement[value.raw=/(^|\\s)(sticker|badge)(\\s|$)/]',
          message:
            "A status is the shared Sticker, its glyph brought by its tone (frame P1-5).",
        },
        {
          // A field's Enter key says what it does (spec §6.3; audit
          // 2026-11-13, frame P2-5 p. 1): «next», «done», «search» on one
          // line, «enter» on several. Choices, a date, a file, a hidden
          // value and the app's own keypad (inputMode none) bring no
          // keyboard of their own.
          selector:
            'JSXOpeningElement[name.name=/^(input|textarea)$/]:not(:has(JSXAttribute[name.name="enterKeyHint"])):not(:has(JSXAttribute[name.name="type"][value.value=/^(radio|checkbox|date|file|hidden)$/])):not(:has(JSXAttribute[name.name="inputMode"][value.value="none"]))',
          message:
            "A field says what its Enter does: enterKeyHint «next», «done», «search», or «enter» for several lines (frame P2-5).",
        },
      ],
    },
  },
  {
    files: ["e2e/**/*.spec.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@playwright/test",
              importNames: ["test"],
              message:
                "Import test from ./fixtures: it lets route handlers answer before the page closes.",
            },
          ],
        },
      ],
    },
  },
);
