import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

/**
 * WCAG 2.2 AA means every A and AA criterion of 2.0, 2.1 and 2.2. Design
 * §12.6.10 names `wcag2a, wcag2aa, wcag21aa, wcag22aa`; `wcag21a` joins them
 * because 2.1's level-A criteria are part of that conformance too.
 */
export const WCAG_22_AA_TAGS = [
  'wcag2a',
  'wcag2aa',
  'wcag21a',
  'wcag21aa',
  'wcag22aa',
] as const;

/**
 * Narrows a scan. The gate is zero violations (§12.6.10), so anything left
 * out carries its reason and tracking item, and an empty reason is refused.
 */
export interface AxeContext {
  /** Scan only this region; the whole document otherwise. */
  readonly include?: string;
  readonly exclude?: readonly {
    readonly selector: string;
    readonly reason: string;
  }[];
  readonly disableRules?: readonly {
    readonly rule: string;
    readonly reason: string;
  }[];
}

type AxeViolation = Awaited<
  ReturnType<AxeBuilder['analyze']>
>['violations'][number];

/**
 * Runs axe over the page as it stands and fails the test on any violation.
 * Call it after the state under test has settled (the same moment a
 * screenshot is taken), once per theme: contrast differs between them.
 */
export async function expectNoAxeViolations(
  page: Page,
  context: AxeContext = {},
): Promise<void> {
  let builder = new AxeBuilder({ page }).withTags([...WCAG_22_AA_TAGS]);
  if (context.include) builder = builder.include(context.include);
  for (const { selector, reason } of context.exclude ?? []) {
    requireReason(selector, reason);
    builder = builder.exclude(selector);
  }
  const disabled = context.disableRules ?? [];
  for (const { rule, reason } of disabled) requireReason(rule, reason);
  if (disabled.length > 0) {
    builder = builder.disableRules(disabled.map(({ rule }) => rule));
  }

  const { violations } = await builder.analyze();
  if (violations.length > 0) {
    // The full nodes and fix hints, for the report; the assertion below
    // keeps the failure message to one line per rule.
    await test.info().attach('axe-violations.json', {
      body: JSON.stringify(violations, null, 2),
      contentType: 'application/json',
    });
  }
  expect(
    violations.map(describeViolation),
    `axe (${WCAG_22_AA_TAGS.join(', ')}) on ${page.url()}`,
  ).toEqual([]);
}

function requireReason(what: string, reason: string): void {
  if (reason.trim() === '') {
    throw new Error(
      `axe waiver for "${what}" needs a reason and a tracking item`,
    );
  }
}

const TARGETS_SHOWN = 3;

function describeViolation(violation: AxeViolation): string {
  const targets = violation.nodes.map((node) =>
    node.target
      .map((part) => (Array.isArray(part) ? part.join(' >>> ') : part))
      .join(' '),
  );
  const shown = targets.slice(0, TARGETS_SHOWN).join(' | ');
  const more =
    targets.length > TARGETS_SHOWN
      ? ` (+${targets.length - TARGETS_SHOWN} more)`
      : '';
  return `${violation.id} [${violation.impact ?? 'n/a'}] ${violation.help}: ${shown}${more}`;
}
