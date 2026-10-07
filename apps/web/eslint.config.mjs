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
    }
    // The e2e folder's `no-restricted-imports` exemption is inherited from
    // the root config (a basePath-independent `**/e2e/**/*.ts` block): a
    // pattern spelled `apps/web/e2e/**` here matched only when the nx
    // executor set basePath to the workspace root.
];
