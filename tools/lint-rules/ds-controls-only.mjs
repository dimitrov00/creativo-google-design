/**
 * `creativo/ds-controls-only` — a template rule (angular-eslint template
 * parser) for feature and app templates: a control is a design-system
 * element, never a native one dressed by the feature. It reports
 *
 *   - `<select>` — a choice of one value is `ui-choice-menu` (or
 *     `ui-segmented-control` / `ui-choice-tiles` when every option shows);
 *   - `role="tablist"`, `role="tab"`, `role="tabpanel"`, static or bound —
 *     a view switch is `ui-segmented-control`, and a row of filter chips is
 *     a `role="group"` of `uiChip` toggles, not a tab list;
 *   - `<input>` / `<textarea>` that wears none of the design-system field
 *     directives (`fieldDirectives`, `uiTextField` by default). A file
 *     picker and a hidden input draw nothing and are let through.
 *
 * The rule is deliberately narrow: each case is one a review found
 * hand-built in a feature (docs/designs/ui-library-parity.md). It does not
 * try to recognise a hand-built control made of `<div>`s — the element
 * index (docs/ui-elements.md) is the guard for that.
 */
import angularEslintUtils from '@angular-eslint/utils';
import { stringLiterals } from './icon-registry-only.mjs';

const { getTemplateParserServices } = angularEslintUtils;

const TAB_ROLES = new Set(['tablist', 'tab', 'tabpanel']);
const CHROMELESS_INPUT_TYPES = new Set(['file', 'hidden']);
const INDEX = 'docs/ui-elements.md';

const messages = {
  nativeSelect: `A native <select> is not used here — a choice of one value is <ui-choice-menu> (see ${INDEX}).`,
  tabRole: `role="{{value}}" is hand-built tabs — a view switch is <ui-segmented-control>; a row of filter chips is role="group" over uiChip toggles (see ${INDEX}).`,
  bareField: `A bare <{{value}}> is a hand-styled field — put a design-system field directive on it (uiTextField) or use the element for the value: ui-search-field, ui-unit-field, ui-code-field, ui-amount-field, ui-slider, uiSwitch (see ${INDEX}).`,
};

export const dsControlsOnly = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Feature templates use design-system controls, never native ones dressed by hand.',
    },
    schema: [
      {
        type: 'object',
        properties: {
          fieldDirectives: { type: 'array', items: { type: 'string' } },
        },
        additionalProperties: false,
      },
    ],
    defaultOptions: [{ fieldDirectives: ['uiTextField'] }],
    messages,
  },
  create(context) {
    const services = getTemplateParserServices(context);
    const fieldDirectives = new Set(
      context.options[0]?.fieldDirectives ?? ['uiTextField'],
    );
    const report = (node, messageId, value) =>
      context.report({
        loc: services.convertNodeSourceSpanToLoc(node.sourceSpan),
        messageId,
        data: { value },
      });

    return {
      Element(node) {
        const attributes = node.attributes ?? [];
        const inputs = node.inputs ?? [];

        if (node.name === 'select') {
          report(node, 'nativeSelect');
          return;
        }

        for (const attribute of attributes) {
          if (attribute.name === 'role' && TAB_ROLES.has(attribute.value)) {
            report(attribute, 'tabRole', attribute.value);
          }
        }
        for (const input of inputs) {
          if (input.name !== 'role') continue;
          for (const literal of stringLiterals(input.value)) {
            if (TAB_ROLES.has(literal)) report(input, 'tabRole', literal);
          }
        }

        if (node.name !== 'input' && node.name !== 'textarea') return;
        const dressed = [...attributes, ...inputs].some((entry) =>
          fieldDirectives.has(entry.name),
        );
        if (dressed) return;
        const chromeless = attributes.some(
          (attribute) =>
            attribute.name === 'type' &&
            CHROMELESS_INPUT_TYPES.has(attribute.value),
        );
        if (!chromeless) report(node, 'bareField', node.name);
      },
    };
  },
};
