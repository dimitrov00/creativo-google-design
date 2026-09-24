/**
 * `creativo/icon-registry-only` — a template rule (angular-eslint template
 * parser) that fails the build when a template bypasses the icon registry:
 *
 *   - `<mat-icon>` or any element wearing a `material-symbols-*` /
 *     `material-icons` class (a raw ligature span);
 *   - `<ui-icon uiName="close">` or `[uiIcon]="'close'"` — a raw glyph name
 *     where a semantic key (`domain.action`) belongs; static attributes and
 *     string literals inside bindings (including `cond ? 'a' : 'b'`) are
 *     both checked;
 *   - `<img src="…logo….svg">` — the brand mark outside `<ui-logo>`;
 *   - a hand-written `<svg>` anywhere but the files named in the rule's
 *     `allowInlineSvg` option — the three that exist are a data ring, a
 *     countdown ring and a choreographed stroke, none of them a glyph.
 *
 * Template type-checking already rejects a raw `uiName` on `ui-icon`; this
 * rule catches the cases types cannot see, and does so at lint time, per
 * project, which is what `nx affected -t lint` runs in CI.
 */
import angularEslintUtils from '@angular-eslint/utils';

const { getTemplateParserServices } = angularEslintUtils;

export const KEY_PATTERN = /^[a-z][a-zA-Z0-9]*(\.[a-z][a-zA-Z0-9]*){1,2}$/;
const MATERIAL_CLASS = /\bmaterial-(symbols(-[a-z]+)?|icons(-[a-z]+)?)\b/i;
const LOGO_FILE = /logo[^"'\s]*\.(svg|png|webp|jpe?g|avif)\b/i;

/**
 * Every string literal an expression can EVALUATE TO: the branches of a
 * conditional, either side of `??` / `||`, a parenthesised expression.
 * Never a comparison operand — `edge === 'before' ? 'a.b' : 'c.d'` yields
 * `a.b` and `c.d`, not `before`.
 */
export function stringLiterals(ast, out = []) {
  if (!ast || typeof ast !== 'object') return out;
  if (typeof ast.value === 'string' && !('receiver' in ast)) {
    out.push(ast.value);
    return out;
  }
  if ('trueExp' in ast || 'falseExp' in ast) {
    stringLiterals(ast.trueExp, out);
    stringLiterals(ast.falseExp, out);
    return out;
  }
  if ('operation' in ast && 'left' in ast) {
    if (ast.operation === '??' || ast.operation === '||') {
      stringLiterals(ast.left, out);
      stringLiterals(ast.right, out);
    }
    return out;
  }
  for (const child of ['expression', 'ast']) {
    if (child in ast) stringLiterals(ast[child], out);
  }
  return out;
}

const messages = {
  matIcon:
    'Angular Material icons are not used here — render icons with <ui-icon uiName="…"> (see libs/ui/icons).',
  materialClass:
    'A "{{value}}" class renders a raw icon-font ligature and bypasses the registry — use <ui-icon uiName="…">.',
  rawKey:
    '"{{value}}" is a raw glyph name, not a semantic key — icons are named by intent (domain.action) in the vocabulary of libs/ui/icons.',
  rawLogo:
    'The logo is resolved through the registry — use <ui-logo> instead of an <img> pointing at "{{value}}".',
  inlineSvg:
    'A hand-drawn <svg> is an icon outside the registry — add a vocabulary key (a Material glyph or a vector entry in libs/ui/icons) and render <ui-icon>. A ring, a chart or a choreographed stroke is allow-listed by file (allowInlineSvg) in eslint.config.mjs.',
};

export const iconRegistryOnly = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Icons and the logo must go through the semantic icon registry.',
    },
    schema: [
      {
        type: 'object',
        properties: {
          allowInlineSvg: { type: 'array', items: { type: 'string' } },
        },
        additionalProperties: false,
      },
    ],
    defaultOptions: [{ allowInlineSvg: [] }],
    messages,
  },
  create(context) {
    const services = getTemplateParserServices(context);
    // Inline templates lint under a virtual name that contains the .ts path,
    // so a substring match covers component files and .html files alike.
    const allowInlineSvg = context.options[0]?.allowInlineSvg ?? [];
    const filename = String(context.filename ?? '')
      .split('\\')
      .join('/');
    const svgAllowedHere = allowInlineSvg.some((part) =>
      filename.includes(part),
    );
    const report = (node, messageId, value) =>
      context.report({
        loc: services.convertNodeSourceSpanToLoc(node.sourceSpan),
        messageId,
        data: { value },
      });

    const checkKey = (node, ownerName, keyNames) => {
      for (const attribute of node.attributes ?? []) {
        if (keyNames(attribute.name) && !KEY_PATTERN.test(attribute.value)) {
          report(attribute, 'rawKey', attribute.value);
        }
      }
      for (const input of node.inputs ?? []) {
        if (!keyNames(input.name)) continue;
        for (const literal of stringLiterals(input.value)) {
          if (!KEY_PATTERN.test(literal)) report(input, 'rawKey', literal);
        }
      }
    };

    return {
      Element(node) {
        if (node.name === 'mat-icon') {
          report(node, 'matIcon');
          return;
        }
        // A hand-drawn <svg> is an icon outside the registry unless this file
        // is one of the allow-listed shapes (rings, choreographed strokes).
        if (/^(:svg:)?svg$/.test(node.name) && !svgAllowedHere) {
          report(node, 'inlineSvg');
          return;
        }

        for (const attribute of node.attributes ?? []) {
          if (
            attribute.name === 'class' &&
            MATERIAL_CLASS.test(attribute.value)
          ) {
            report(
              attribute,
              'materialClass',
              attribute.value.match(MATERIAL_CLASS)[0],
            );
          }
        }
        for (const input of node.inputs ?? []) {
          const inClassBinding =
            input.name === 'class' || input.name === 'ngClass';
          const classNameBinding = MATERIAL_CLASS.test(input.name);
          const source = input.value?.source ?? '';
          if (
            classNameBinding ||
            (inClassBinding && MATERIAL_CLASS.test(source))
          ) {
            report(
              input,
              'materialClass',
              (input.name + ' ' + source).match(MATERIAL_CLASS)[0],
            );
          }
        }

        if (node.name === 'img') {
          for (const attribute of node.attributes ?? []) {
            if (attribute.name === 'src' && LOGO_FILE.test(attribute.value)) {
              report(attribute, 'rawLogo', attribute.value);
            }
          }
          for (const input of node.inputs ?? []) {
            if (input.name !== 'src') continue;
            for (const literal of stringLiterals(input.value)) {
              if (LOGO_FILE.test(literal)) report(input, 'rawLogo', literal);
            }
          }
        }

        // `uiName` is a KEY only on ui-icon (ui-avatar's uiName is a person's
        // name); `uiIcon` is a key wherever it appears (avatar, search field…).
        checkKey(
          node,
          node.name,
          (name) =>
            (name === 'uiName' && node.name === 'ui-icon') || name === 'uiIcon',
        );
      },
    };
  },
};
