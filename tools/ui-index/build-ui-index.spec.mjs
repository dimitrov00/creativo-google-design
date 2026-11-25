import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  LIBRARIES,
  OUTPUT,
  WORKSPACE_ROOT,
  aliasesOf,
  collect,
  exportedFiles,
  format,
  parseElements,
  render,
  selectorNames,
  validate,
} from './build-ui-index.mjs';

const MENU = `
import { Component, Directive } from '@angular/core';

/**
 * A row inside the menu.
 *
 * @uiPartOf ui-menu
 * @uiPurpose One choice inside a menu.
 */
@Directive({
  selector:
    'button[uiMenuItem], a[uiMenuItem]',
})
export class UiMenuItem {}

/**
 * Prose about the menu, with a \`code\` span.
 *
 * @uiPurpose A list of actions that opens from a control
 *   and closes on a pick.
 * @uiSwiftUI \`Menu\`
 * @uiAliases Dropdown, popover , context menu
 * @uiNotThis The choice is one value of a field: \`ui-choice-menu\`.
 */
@Component({ selector: 'ui-menu', template: '' })
export class UiMenu {}

@Component({ selector: 'ui-private', template: '' })
class NotExported {}

export class PlainClass {}
`;

const CHOICE = `
/**
 * @uiPurpose Choose one option from a list that opens on tap.
 * @uiSwiftUI none
 * @uiAliases select
 */
@Component({ selector: 'ui-choice-menu', template: '' })
export class UiChoiceMenu {}
`;

const elements = () => [
  ...parseElements(MENU, 'patterns/menu.ts'),
  ...parseElements(CHOICE, 'controls/choice-menu.ts'),
];

describe('build-ui-index', () => {
  it('reads the local files a barrel exports and skips other packages', () => {
    const barrel = [
      "export * from './lib/button/button';",
      "export * from '@creativo/ui/icons';",
      'export {',
      '  A,',
      "} from './lib/material/material';",
    ].join('\n');
    expect(exportedFiles(barrel)).toEqual([
      './lib/button/button',
      './lib/material/material',
    ]);
  });

  it('indexes exported decorated classes only, with their tags on one line', () => {
    const parsed = parseElements(MENU, 'patterns/menu.ts');
    expect(parsed.map((e) => e.className)).toEqual(['UiMenuItem', 'UiMenu']);
    expect(parsed[0].selector).toBe('button[uiMenuItem], a[uiMenuItem]');
    expect(parsed[0].tags).toEqual({
      uiPartOf: 'ui-menu',
      uiPurpose: 'One choice inside a menu.',
    });
    expect(parsed[1].tags.uiPurpose).toBe(
      'A list of actions that opens from a control and closes on a pick.',
    );
    expect(parsed[1].tags.uiSwiftUI).toBe('`Menu`');
  });

  it('names a selector by its tag or its attribute', () => {
    expect(selectorNames('ui-card, a[uiCard], button[uiCard]')).toEqual([
      'ui-card',
      'uiCard',
    ]);
    expect(selectorNames('ng-template[uiChoiceLeading]')).toEqual([
      'uiChoiceLeading',
    ]);
    expect(selectorNames('[uiPadding], [uiPaddingHorizontal]')).toEqual([
      'uiPadding',
      'uiPaddingHorizontal',
    ]);
  });

  it('lower-cases and trims aliases', () => {
    expect(aliasesOf(elements()[1])).toEqual([
      'dropdown',
      'popover',
      'context menu',
    ]);
  });

  it('accepts a fully tagged set', () => {
    expect(validate(elements())).toEqual([]);
  });

  it('refuses an element with no tags, naming each missing one', () => {
    const bare = parseElements(
      "@Component({ selector: 'ui-bare', template: '' })\nexport class UiBare {}",
      'controls/bare.ts',
    );
    expect(validate(bare)).toEqual([
      'controls/bare.ts (UiBare): missing @uiPurpose',
      'controls/bare.ts (UiBare): missing @uiSwiftUI (write `none` for a pattern of this app)',
      'controls/bare.ts (UiBare): missing @uiAliases',
    ]);
  });

  it('refuses a part whose parent is unknown or is itself', () => {
    const withParent = (parent) => [
      ...parseElements(
        MENU.replace('@uiPartOf ui-menu', `@uiPartOf ${parent}`),
        'patterns/menu.ts',
      ),
      ...parseElements(CHOICE, 'controls/choice-menu.ts'),
    ];
    const orphan = withParent('ui-nowhere');
    expect(validate(orphan)).toEqual([
      'patterns/menu.ts (UiMenuItem): @uiPartOf names `ui-nowhere`, which no exported element answers to',
    ]);
    const self = withParent('uiMenuItem');
    expect(validate(self)).toEqual([
      'patterns/menu.ts (UiMenuItem): @uiPartOf names the element itself',
    ]);
  });

  it('refuses a @uiNotThis that points at an element that does not exist', () => {
    // The menu alone: its note names ui-choice-menu, which is not in the set.
    expect(validate(parseElements(MENU, 'patterns/menu.ts'))).toEqual([
      'patterns/menu.ts (UiMenu): @uiNotThis names `ui-choice-menu`, which no exported element answers to',
    ]);
  });

  it('refuses two elements that answer to one name', () => {
    const twice = [
      ...parseElements(CHOICE, 'controls/a.ts'),
      ...parseElements(CHOICE, 'controls/b.ts'),
    ];
    expect(validate(twice)).toEqual([
      'controls/b.ts (UiChoiceMenu): `ui-choice-menu` is already indexed from controls/a.ts',
    ]);
  });

  it('renders an alias table, a table per library and the parts beside it', () => {
    const [item, menu, choice] = elements();
    const markdown = render([
      { name: 'controls', elements: [choice] },
      { name: 'patterns', elements: [menu, item] },
      { name: 'charts', elements: [] },
    ]);
    expect(markdown).toContain('| dropdown | `ui-menu` |');
    expect(markdown).toContain('| select | `ui-choice-menu` |');
    expect(markdown).toContain(
      '| `ui-choice-menu` | Choose one option from a list that opens on tap. | App pattern |  |',
    );
    expect(markdown).toContain(
      '| `button[uiMenuItem], a[uiMenuItem]` | `ui-menu` | One choice inside a menu. |',
    );
    expect(markdown).not.toContain('## charts');
    // A part has no aliases of its own: it is found through its parent.
    expect(markdown).not.toContain('`uiMenuItem` |');
  });

  it('renders the same text for the same input, whatever the order', () => {
    const [item, menu, choice] = elements();
    const one = render([{ name: 'patterns', elements: [menu, item, choice] }]);
    const two = render([{ name: 'patterns', elements: [choice, item, menu] }]);
    expect(one).toBe(two);
  });
});

describe('the committed index', () => {
  const libraries = collect();
  const all = libraries.flatMap((library) => library.elements);

  it('covers every sub-library of libs/ui', () => {
    expect(libraries.map((library) => library.name)).toEqual(LIBRARIES);
    expect(all.length).toBeGreaterThan(90);
  });

  it('has every exported element tagged', () => {
    expect(validate(all)).toEqual([]);
  });

  it('is up to date with the tags', async () => {
    const committed = readFileSync(join(WORKSPACE_ROOT, OUTPUT), 'utf8');
    expect(await format(render(libraries))).toBe(committed);
  });

  it('answers the words the dropdown incident was searched by', () => {
    const names = (alias) =>
      all
        .filter((element) => aliasesOf(element).includes(alias))
        .map((element) => selectorNames(element.selector)[0]);
    expect(names('select')).toContain('ui-choice-menu');
    expect(names('dropdown')).toContain('ui-choice-menu');
  });
});
