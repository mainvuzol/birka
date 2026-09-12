import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist", "node_modules"] },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      parserOptions: { project: ["./tsconfig.json"], tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      // `any` hides exactly the API-shape mistakes this client must not make.
      "@typescript-eslint/no-explicit-any": "error",
    },
  },
);
