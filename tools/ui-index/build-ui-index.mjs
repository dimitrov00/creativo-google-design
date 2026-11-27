#!/usr/bin/env node
/**
 * The design system's element index — one searchable row per exported
 * element of `libs/ui`, generated from tags in each element's own docblock.
 *
 *   node tools/ui-index/build-ui-index.mjs           # write docs/ui-elements.md
 *   node tools/ui-index/build-ui-index.mjs --check   # exit 1 on a missing tag or a stale file
 *
 * Why it exists: an agent once built its own dropdown look in a feature
 * because nothing it read named `ui-choice-menu`. The index is the one file
 * that answers "which element do I use for this?", by the words people
 * search with (select, dropdown, toggle, modal), and the check keeps it
 * complete: an exported element with no row fails CI.
 *
 * The tags, in the docblock above the `@Component` / `@Directive`:
 *
 *   @uiPurpose  one sentence: the job this element does            (required)
 *   @uiSwiftUI  the SwiftUI type and style it corresponds to, or
 *               `none` for a pattern of this app                    (required)
 *   @uiAliases  comma-separated words people search by             (required)
 *   @uiNotThis  when another element is the right one              (optional)
 *
 * A piece that only exists inside another element (a menu's item, a
 * headline's media slot) says so and needs nothing but its purpose:
 *
 *   @uiPartOf   the parent's name, e.g. `ui-menu`
 *   @uiPurpose  one sentence
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import prettier from 'prettier';
import ts from 'typescript';

const here = dirname(fileURLToPath(import.meta.url));
export const WORKSPACE_ROOT = resolve(here, '..', '..');
export const OUTPUT = 'docs/ui-elements.md';

/** The sub-libraries of `libs/ui` that export elements, in reading order. */
export const LIBRARIES = [
  'controls',
  'layout',
  'patterns',
  'modifiers',
  'charts',
  'icons',
];

const TAGS = ['uiPurpose', 'uiSwiftUI', 'uiAliases', 'uiNotThis', 'uiPartOf'];
const NO_COUNTERPART = 'none';

/**
 * The files a sub-library's barrel exports from its own `lib/` folder. A
 * re-export of another package (`@creativo/ui/layout`) belongs to that
 * package's own row set and is skipped here.
 */
export function exportedFiles(barrelText) {
  const files = [];
  const pattern = /export\s+(?:\*|\{[^}]*\})\s+from\s+'(\.\/[^']+)'/g;
  for (const match of barrelText.matchAll(pattern)) files.push(match[1]);
  return files;
}

function decoratorSelector(node) {
  for (const decorator of ts.getDecorators(node) ?? []) {
    const call = decorator.expression;
    if (!ts.isCallExpression(call) || !ts.isIdentifier(call.expression)) {
      continue;
    }
    const kind = call.expression.text;
    if (kind !== 'Component' && kind !== 'Directive') continue;
    const [options] = call.arguments;
    if (!options || !ts.isObjectLiteralExpression(options)) continue;
    for (const property of options.properties) {
      if (
        ts.isPropertyAssignment(property) &&
        ts.isIdentifier(property.name) &&
        property.name.text === 'selector' &&
        (ts.isStringLiteral(property.initializer) ||
          ts.isNoSubstitutionTemplateLiteral(property.initializer))
      ) {
        return property.initializer.text;
      }
    }
  }
  return null;
}

function oneLine(text) {
  return text.replace(/\s+/g, ' ').trim();
}

function docTags(node) {
  const tags = {};
  for (const tag of ts.getJSDocTags(node)) {
    const name = tag.tagName.text;
    if (!TAGS.includes(name)) continue;
    tags[name] = oneLine(ts.getTextOfJSDocComment(tag.comment) ?? '');
  }
  return tags;
}

/**
 * Every exported class of one source file that Angular knows by a selector,
 * with its index tags. A class that is not exported is not part of the
 * library's surface and is left out.
 */
export function parseElements(sourceText, file) {
  const source = ts.createSourceFile(
    file,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
  );
  const elements = [];
  for (const node of source.statements) {
    if (!ts.isClassDeclaration(node) || !node.name) continue;
    const exported = (ts.getModifiers(node) ?? []).some(
      (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
    );
    if (!exported) continue;
    const selector = decoratorSelector(node);
    if (selector === null) continue;
    elements.push({
      file,
      className: node.name.text,
      selector: oneLine(selector),
      tags: docTags(node),
    });
  }
  return elements;
}

/**
 * The names one selector answers to: `ui-menu` for an element selector,
 * `uiButton` for `button[uiButton]`. The first is the row's name.
 */
export function selectorNames(selector) {
  const names = [];
  for (const part of selector.split(',')) {
    const text = part.trim();
    const attribute = text.match(/\[([A-Za-z][\w-]*)\]/);
    const name = attribute ? attribute[1] : text;
    if (name && !names.includes(name)) names.push(name);
  }
  return names;
}

export function aliasesOf(element) {
  return (element.tags.uiAliases ?? '')
    .split(',')
    .map((alias) => alias.trim().toLowerCase())
    .filter((alias) => alias.length > 0);
}

/** Every reason the index cannot be trusted, one sentence each. */
export function validate(elements) {
  const problems = [];
  const known = new Set(elements.flatMap((e) => selectorNames(e.selector)));
  const where = (element) => `${element.file} (${element.className})`;

  for (const element of elements) {
    const { tags } = element;
    if (!tags.uiPurpose) {
      problems.push(`${where(element)}: missing @uiPurpose`);
    }
    if (tags.uiPartOf !== undefined) {
      const parent = tags.uiPartOf.replace(/`/g, '');
      if (!known.has(parent)) {
        problems.push(
          `${where(element)}: @uiPartOf names \`${parent}\`, which no exported element answers to`,
        );
      } else if (selectorNames(element.selector).includes(parent)) {
        problems.push(`${where(element)}: @uiPartOf names the element itself`);
      }
      continue;
    }
    if (!tags.uiSwiftUI) {
      problems.push(
        `${where(element)}: missing @uiSwiftUI (write \`${NO_COUNTERPART}\` for a pattern of this app)`,
      );
    }
    if (aliasesOf(element).length === 0) {
      problems.push(`${where(element)}: missing @uiAliases`);
    }
    for (const [mention] of (tags.uiNotThis ?? '').matchAll(
      /\bui-[a-z][a-z-]*[a-z]\b/g,
    )) {
      if (!known.has(mention)) {
        problems.push(
          `${where(element)}: @uiNotThis names \`${mention}\`, which no exported element answers to`,
        );
      }
    }
  }

  const seen = new Map();
  for (const element of elements) {
    const [name] = selectorNames(element.selector);
    if (seen.has(name)) {
      problems.push(
        `${where(element)}: \`${name}\` is already indexed from ${seen.get(name)}`,
      );
    }
    seen.set(name, element.file);
  }
  return problems;
}

function cell(text) {
  return text.replace(/\|/g, '\\|');
}

function code(text) {
  return `\`${text}\``;
}

function swiftUI(element) {
  const value = element.tags.uiSwiftUI ?? '';
  return value.toLowerCase() === NO_COUNTERPART ? 'App pattern' : value;
}

function byName(a, b) {
  return selectorNames(a.selector)[0].localeCompare(
    selectorNames(b.selector)[0],
  );
}

/** The index as Markdown, before Prettier lays the tables out. */
export function render(libraries) {
  const all = libraries.flatMap((library) => library.elements);
  const lines = [
    '# UI elements',
    '',
    '<!-- GENERATED by tools/ui-index/build-ui-index.mjs from the docblock tags',
    "     in libs/ui. Do not edit: change the element's tags and run",
    '     `pnpm ui:index`. -->',
    '',
    'Every element the design system exports, and what to reach for when.',
    'Look here before writing any control in a template. A feature never',
    'styles a native control or builds its own; a new element is added to',
    '`libs/ui` only when the owner asks for one.',
    '',
    '## Find by the word you would search',
    '',
    '| You are looking for | Use |',
    '| --- | --- |',
  ];

  const aliases = new Map();
  for (const element of all) {
    if (element.tags.uiPartOf !== undefined) continue;
    const [name] = selectorNames(element.selector);
    for (const alias of aliasesOf(element)) {
      aliases.set(alias, [...(aliases.get(alias) ?? []), name]);
    }
  }
  for (const alias of [...aliases.keys()].sort((a, b) => a.localeCompare(b))) {
    const names = aliases.get(alias).sort((a, b) => a.localeCompare(b));
    lines.push(`| ${cell(alias)} | ${names.map(code).join(', ')} |`);
  }

  for (const library of libraries) {
    const whole = library.elements
      .filter((element) => element.tags.uiPartOf === undefined)
      .sort(byName);
    const parts = library.elements
      .filter((element) => element.tags.uiPartOf !== undefined)
      .sort(byName);
    if (whole.length + parts.length === 0) continue;
    lines.push('', `## ${library.name}`, '');
    lines.push(`Import from \`@creativo/ui/${library.name}\`.`, '');
    if (whole.length > 0) {
      lines.push(
        '| Element | What it is for | SwiftUI | Not this when |',
        '| --- | --- | --- | --- |',
      );
      for (const element of whole) {
        lines.push(
          `| ${code(cell(element.selector))} | ${cell(element.tags.uiPurpose ?? '')} | ${cell(swiftUI(element))} | ${cell(element.tags.uiNotThis ?? '')} |`,
        );
      }
    }
    if (parts.length > 0) {
      lines.push(
        '',
        '| Part | Belongs to | What it is for |',
        '| --- | --- | --- |',
      );
      for (const element of parts) {
        lines.push(
          `| ${code(cell(element.selector))} | ${code(element.tags.uiPartOf.replace(/`/g, ''))} | ${cell(element.tags.uiPurpose ?? '')} |`,
        );
      }
    }
  }
  return `${lines.join('\n')}\n`;
}

/** Reads `libs/ui` under `root` and returns its elements by sub-library. */
export function collect(root = WORKSPACE_ROOT) {
  return LIBRARIES.map((name) => {
    const source = join(root, 'libs/ui', name, 'src');
    // The barrel, and every entry of its own beside it (an element kept
    // out of the barrel so only the screens that mount it load it —
    // `rich-text-editor.ts`).
    const entries = readdirSync(source)
      .filter(
        (file) =>
          file.endsWith('.ts') &&
          !file.endsWith('.spec.ts') &&
          file !== 'test-setup.ts',
      )
      .sort((a, b) =>
        a === 'index.ts' ? -1 : b === 'index.ts' ? 1 : a.localeCompare(b),
      );
    const specifiers = entries.flatMap((entry) =>
      exportedFiles(readFileSync(join(source, entry), 'utf8')),
    );
    const elements = specifiers.flatMap((specifier) => {
      const file = join(source, `${specifier}.ts`);
      if (!existsSync(file)) return [];
      return parseElements(readFileSync(file, 'utf8'), relative(root, file));
    });
    return { name, elements };
  });
}

export async function format(markdown, root = WORKSPACE_ROOT) {
  const target = join(root, OUTPUT);
  const options = (await prettier.resolveConfig(target)) ?? {};
  return prettier.format(markdown, { ...options, filepath: target });
}

async function main(argv) {
  const check = argv.includes('--check');
  const libraries = collect();
  const problems = validate(libraries.flatMap((library) => library.elements));
  if (problems.length > 0) {
    console.error(
      `ui-index: ${problems.length} problem(s) in the element tags of libs/ui:\n`,
    );
    for (const problem of problems) console.error(`  ${problem}`);
    console.error(
      '\nEvery exported element needs @uiPurpose, @uiSwiftUI and @uiAliases in',
      '\nits docblock (or @uiPartOf and @uiPurpose). See the head of',
      '\ntools/ui-index/build-ui-index.mjs.',
    );
    return 1;
  }

  const markdown = await format(render(libraries));
  const target = join(WORKSPACE_ROOT, OUTPUT);
  if (!check) {
    writeFileSync(target, markdown);
    const count = libraries.reduce((sum, l) => sum + l.elements.length, 0);
    console.log(`ui-index: wrote ${OUTPUT} (${count} elements)`);
    return 0;
  }
  const committed = existsSync(target) ? readFileSync(target, 'utf8') : '';
  if (committed !== markdown) {
    console.error(
      `ui-index: ${OUTPUT} is out of date with the element tags. Run \`pnpm ui:index\` and commit the result.`,
    );
    return 1;
  }
  console.log(`ui-index: ${OUTPUT} is up to date`);
  return 0;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  process.exitCode = await main(process.argv.slice(2));
}
