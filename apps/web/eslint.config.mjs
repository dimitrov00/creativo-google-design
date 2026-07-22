import playwrightPlugin from "eslint-plugin-playwright";
import nx from "@nx/eslint-plugin";
import baseConfig from "../../eslint.config.mjs";

export default [
    playwrightPlugin.configs["flat/recommended"],
    ...nx.configs["flat/angular"],
    ...nx.configs["flat/angular-template"],
    ...baseConfig,
    {
        files: [
            "**/*.ts"
        ],
        rules: {
            "@angular-eslint/directive-selector": [
                "error",
                {
                    type: "attribute",
                    prefix: "cr",
                    style: "camelCase"
                }
            ],
            "@angular-eslint/component-selector": [
                "error",
                {
                    type: "element",
                    prefix: "cr",
                    style: "kebab-case"
                }
            ]
        }
    },
    {
        files: [
            "**/*.html"
        ],
        // Override or add rules here
        rules: {}
    },
    {
        // Playwright/Node-side test tooling (apps/web/e2e/support) mints
        // Firebase Admin custom tokens directly against the Auth emulator —
        // it never ships in the app bundle, so the infrastructure-only
        // firebase/* boundary (blueprint §1.2) doesn't apply here (mirrors
        // how each libs/infrastructure/*/eslint.config.mjs turns this rule
        // off for its own exempt zone).
        files: ["apps/web/e2e/**/*.ts"],
        rules: {
            "no-restricted-imports": "off"
        }
    }
];
