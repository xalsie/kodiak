import { defineConfig, globalIgnores } from "eslint/config";
import tseslint from "@typescript-eslint/eslint-plugin";
import tsparser from "@typescript-eslint/parser";
import prettierPlugin from "eslint-plugin-prettier";

export default defineConfig([
    // globalIgnores(["node_modules/*", "dist/*", "build/*", "test/*"]),
    {
        ignores: ["**/node_modules/**", "**/dist/**"],
    },
    {
        files: ["**/*.ts"],
        languageOptions: {
            parser: tsparser,
            sourceType: "module",
        },
        plugins: {
            "@typescript-eslint": tseslint,
            prettier: prettierPlugin,
        },
        rules: {
            ...tseslint.configs.recommended.rules,
            "@typescript-eslint/no-unused-vars": "warn",
            "@typescript-eslint/no-explicit-any": "warn",
            "arrow-spacing": ["warn", { before: true, after: true }],
            "comma-spacing": "warn",
            "comma-style": "warn",
            curly: ["error", "multi-line", "consistent"],
            "dot-location": ["warn", "property"],
            "handle-callback-err": "off",
            "keyword-spacing": "warn",
            "max-nested-callbacks": ["warn", { max: 4 }],
            "max-statements-per-line": ["warn", { max: 2 }],
            "no-console": "warn",
            "no-empty-function": "warn",
            "no-floating-decimal": "warn",
            "no-inline-comments": "warn",
            "no-lonely-if": "error",
            "no-multi-spaces": "warn",
            "no-multiple-empty-lines": ["warn", { max: 2, maxEOF: 1, maxBOF: 0 }],
            "no-shadow": ["warn", { allow: ["err", "resolve", "reject"] }],
            "no-trailing-spaces": ["warn", { skipBlankLines: false }],
            "no-var": "warn",
            "no-undef": "off",
            "object-curly-spacing": ["error", "always"],
            "prefer-const": "warn",
            quotes: ["warn", "double"],
            semi: ["warn", "always"],
            "space-before-blocks": "warn",
            "space-before-function-paren": [
                "warn",
                {
                    anonymous: "never",
                    named: "never",
                    asyncArrow: "always",
                },
            ],
            "space-in-parens": "warn",
            "space-infix-ops": "warn",
            "space-unary-ops": "warn",
            "spaced-comment": "warn",
            yoda: "error",
        },
    },
]);
