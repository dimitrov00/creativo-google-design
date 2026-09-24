import { RuleTester } from 'eslint';
import templateParser from '@angular-eslint/template-parser';
import { iconRegistryOnly } from './icon-registry-only.mjs';

const tester = new RuleTester({
  languageOptions: { parser: templateParser },
});

tester.run('creativo/icon-registry-only', iconRegistryOnly, {
  valid: [
    { code: '<ui-icon uiName="sheet.close" />' },
    {
      code: '<ui-icon [uiName]="open() ? \'frame.collapse\' : \'frame.expand\'" uiScale="large" />',
    },
    { code: '<ui-icon [uiName]="row.icon" />' },
    // Comparison operands are not candidate keys.
    {
      code: "<ui-icon [uiName]=\"edge === 'before' ? 'frame.handleStart' : 'frame.handleEnd'\" />",
    },
    {
      code: "<ui-icon [uiName]=\"kind !== 'x' ? (fallback ?? 'nav.back') : 'nav.disclosure'\" />",
    },
    { code: '<ui-search-field uiIcon="action.search" />' },
    // ui-avatar's uiName is a PERSON, never a key.
    { code: '<ui-avatar [uiName]="client.label" uiName="Иван" />' },
    { code: '<ui-logo uiLabel="Creativo" />' },
    { code: '<img src="/work/cut-01.jpg" alt="" />' },
    { code: '<span class="badge material">x</span>' },
    // A ring is not a glyph — allowed where the config says so, by file.
    {
      code: '<svg viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="24" r="21" /></svg>',
      filename:
        'libs/ui/controls/src/lib/progress-ring/progress-ring.ts/inline-template.html',
      options: [{ allowInlineSvg: ['progress-ring/progress-ring.ts'] }],
    },
  ],
  invalid: [
    {
      code: '<svg viewBox="0 0 24 24"><path d="M8.5 8.5l7 7M15.5 8.5l-7 7" /></svg>',
      filename: 'libs/features/x/src/lib/x.html',
      errors: [{ messageId: 'inlineSvg' }],
    },
    {
      code: '<mat-icon>close</mat-icon>',
      errors: [{ messageId: 'matIcon' }],
    },
    {
      code: '<span class="ui-x material-symbols-rounded">close</span>',
      errors: [
        {
          messageId: 'materialClass',
          data: { value: 'material-symbols-rounded' },
        },
      ],
    },
    {
      code: '<i class="material-icons">delete</i>',
      errors: [
        { messageId: 'materialClass', data: { value: 'material-icons' } },
      ],
    },
    {
      code: '<span [class.material-symbols-outlined]="true">close</span>',
      errors: [{ messageId: 'materialClass' }],
    },
    {
      code: '<span [ngClass]="{ \'material-symbols-rounded\': on }">close</span>',
      errors: [{ messageId: 'materialClass' }],
    },
    {
      code: '<ui-icon uiName="close" />',
      errors: [{ messageId: 'rawKey', data: { value: 'close' } }],
    },
    {
      code: '<ui-icon [uiName]="\'delete\'" />',
      errors: [{ messageId: 'rawKey', data: { value: 'delete' } }],
    },
    {
      code: "<ui-icon [uiName]=\"busy ? 'visit.now' : 'hourglass_top'\" />",
      errors: [{ messageId: 'rawKey', data: { value: 'hourglass_top' } }],
    },
    {
      code: '<ui-avatar uiIcon="person" />',
      errors: [{ messageId: 'rawKey', data: { value: 'person' } }],
    },
    {
      code: '<img src="/logo-white.svg" alt="Creativo" />',
      errors: [{ messageId: 'rawLogo', data: { value: '/logo-white.svg' } }],
    },
    {
      code: '<img [src]="dark ? \'/logo-white.svg\' : \'/logo-black.svg\'" alt="Creativo" />',
      errors: [{ messageId: 'rawLogo' }, { messageId: 'rawLogo' }],
    },
  ],
});
