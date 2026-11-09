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
    files: ["src/**/*.tsx"],
    ignores: ["src/shared/Unread.tsx"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector:
            'JSXElement:has(> JSXOpeningElement:has(JSXAttribute[name.name="role"][value.value="alert"])):has(CallExpression[callee.name="readText"])',
          message:
            "A read that failed is the shared Unread's plate, never a bare alert (frame P1-2).",
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
