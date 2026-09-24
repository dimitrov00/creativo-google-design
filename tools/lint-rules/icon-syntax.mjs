/**
 * `no-restricted-syntax` selectors that keep icon artwork inside the
 * registry boundary (`libs/ui/icons`). Used by the root eslint.config.mjs
 * and exercised by icon-syntax.spec.mjs so the selectors are tested, not
 * just configured.
 */
const ICON_PACKAGE = String.raw`^(material-symbols|@material-symbols\/|@angular\/material)`;
const MATERIAL_WORD = String.raw`material[-_ ]?(symbols|icons)`;

export const ICON_SYNTAX_RESTRICTIONS = [
  {
    selector: `ImportDeclaration[source.value=/${ICON_PACKAGE}/]`,
    message:
      'Icon artwork ships only through @creativo/ui/icons (ui-icon, ui-logo, UiIconRegistry). Import nothing from an icon font or Angular Material.',
  },
  {
    selector: `ImportExpression[source.value=/${ICON_PACKAGE}/]`,
    message:
      'Icon artwork ships only through @creativo/ui/icons. Do not lazy-load an icon font or Angular Material.',
  },
  {
    selector:
      "TSAsExpression > TSTypeReference > Identifier[name='UiIconName']",
    message:
      'Never cast to UiIconName — the closed union is the compile-time guard. Add the key to the vocabulary, or narrow with isUiIconName().',
  },
  {
    selector:
      "TSTypeAssertion > TSTypeReference > Identifier[name='UiIconName']",
    message:
      'Never cast to UiIconName — the closed union is the compile-time guard. Add the key to the vocabulary, or narrow with isUiIconName().',
  },
  {
    selector: `Literal[value=/${MATERIAL_WORD}/i]`,
    message:
      'A Material icon class or font name in code bypasses the registry. Render icons with <ui-icon uiName="…"> or UiIconRegistry.createElement().',
  },
  {
    selector: `TemplateElement[value.raw=/${MATERIAL_WORD}/i]`,
    message:
      'A Material icon class or font name in code bypasses the registry. Render icons with <ui-icon uiName="…"> or UiIconRegistry.createElement().',
  },
];
