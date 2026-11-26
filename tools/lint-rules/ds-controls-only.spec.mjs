import { RuleTester } from 'eslint';
import templateParser from '@angular-eslint/template-parser';
import { dsControlsOnly } from './ds-controls-only.mjs';

const tester = new RuleTester({
  languageOptions: { parser: templateParser },
});

tester.run('creativo/ds-controls-only', dsControlsOnly, {
  valid: [
    { code: '<input uiTextField type="email" [value]="email()" />' },
    { code: '<textarea uiTextField uiControlSize="large"></textarea>' },
    { code: '<input [uiTextField]="true" />' },
    // A file picker and a hidden input draw nothing of their own.
    { code: '<input type="file" accept="image/*" hidden />' },
    { code: '<input type="hidden" name="token" />' },
    // A chip row is a group of toggles.
    {
      code: '<div role="group" aria-label="Filter"><button uiChip>All</button></div>',
    },
    { code: '<div [attr.role]="grouped() ? \'group\' : null"></div>' },
    // A comparison operand is not a role the element takes.
    { code: "<div [attr.role]=\"kind === 'tab' ? 'group' : null\"></div>" },
    { code: '<ui-segmented-control [uiSegments]="views()" />' },
    { code: '<ui-choice-menu [uiOptions]="options()" />' },
    {
      code: '<input uiPhoneInput />',
      options: [{ fieldDirectives: ['uiTextField', 'uiPhoneInput'] }],
    },
  ],
  invalid: [
    {
      code: '<select><option>One</option></select>',
      errors: [{ messageId: 'nativeSelect' }],
    },
    {
      code: '<div role="tablist"><button role="tab">List</button></div><section role="tabpanel"></section>',
      errors: [
        { messageId: 'tabRole', data: { value: 'tablist' } },
        { messageId: 'tabRole', data: { value: 'tab' } },
        { messageId: 'tabRole', data: { value: 'tabpanel' } },
      ],
    },
    {
      code: "<div [attr.role]=\"switching() ? 'tablist' : 'group'\"></div>",
      errors: [{ messageId: 'tabRole', data: { value: 'tablist' } }],
    },
    {
      code: '<input class="my-field" type="text" />',
      errors: [{ messageId: 'bareField', data: { value: 'input' } }],
    },
    {
      code: '<input type="checkbox" [checked]="on()" />',
      errors: [{ messageId: 'bareField', data: { value: 'input' } }],
    },
    {
      code: '<textarea class="note"></textarea>',
      errors: [{ messageId: 'bareField', data: { value: 'textarea' } }],
    },
    // The default directive list is replaced by the option, not merged.
    {
      code: '<input uiTextField />',
      options: [{ fieldDirectives: ['uiOther'] }],
      errors: [{ messageId: 'bareField' }],
    },
  ],
});
