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

  const found = await builder.analyze();
  const violations = await rejudgeNameMismatches(page, found.violations);
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

const NAME_MISMATCH = 'label-content-name-mismatch';

/**
 * axe's own measure of WCAG 2.5.3 fails every labelled control that draws
 * its words as separate blocks: it reads the blocks as one run with no
 * space between them («Бакшиши0,00 €») and looks for that run in the label.
 * Measured 2026-11-26 on bare markup — three `div`s under a label of the
 * same three phrases fail, with or without commas.
 *
 * So each node axe reports is judged again with the browser's own reading
 * of the drawn text (`innerText`, which keeps the breaks between blocks):
 * the node stands unless the label holds every drawn word, in order and
 * unbroken. Nothing is forgiven that a person can see and the label leaves
 * out — text hidden from readers (`aria-hidden`) is still drawn, and still
 * counts. What survives says both readings, so the difference is in the
 * failure message.
 */
async function rejudgeNameMismatches(
  page: Page,
  violations: readonly AxeViolation[],
): Promise<AxeViolation[]> {
  const judged: AxeViolation[] = [];
  for (const violation of violations) {
    if (violation.id !== NAME_MISMATCH) {
      judged.push(violation);
      continue;
    }
    const nodes: AxeViolation['nodes'] = [];
    for (const node of violation.nodes) {
      const [selector] = node.target;
      // A target inside a shadow root or a frame is an array: left to axe.
      const readings =
        typeof selector === 'string'
          ? await page.evaluate(readNameAndDrawnText, selector)
          : null;
      if (readings === null || !readings.holds) {
        nodes.push(
          readings === null
            ? node
            : {
                ...node,
                failureSummary: `named «${readings.name}», draws «${readings.drawn}»`,
              },
        );
      }
    }
    if (nodes.length > 0) judged.push({ ...violation, nodes });
  }
  return judged;
}

/** Runs in the page: the control's label and the words it draws, as words. */
function readNameAndDrawnText(
  selector: string,
): { name: string; drawn: string; holds: boolean } | null {
  const element = document.querySelector<HTMLElement>(selector);
  if (element === null) return null;
  const words = (text: string): string =>
    text
      .normalize('NFKC')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .trim();
  const labelledBy = (element.getAttribute('aria-labelledby') ?? '')
    .split(/\s+/)
    .map((id) => document.getElementById(id)?.textContent ?? '')
    .join(' ');
  const name = words(element.getAttribute('aria-label') ?? labelledBy);
  // An SVG part has no `innerText`: its text is its content.
  const drawn = words(element.innerText ?? element.textContent ?? '');
  return { name, drawn, holds: ` ${name} `.includes(` ${drawn} `) };
}

function requireReason(what: string, reason: string): void {
  if (reason.trim() === '') {
    throw new Error(
      `axe waiver for "${what}" needs a reason and a tracking item`,
    );
  }
}

const TARGETS_SHOWN = 3;

/** What was measured on the first node, where the rule measures something: the two readings of a name, or the two colours and their ratio. */
function measured(violation: AxeViolation): string {
  const [node] = violation.nodes;
  if (node === undefined) return '';
  if (violation.id === NAME_MISMATCH) {
    return node.failureSummary ? ` (${node.failureSummary})` : '';
  }
  if (violation.id === 'color-contrast') {
    const data: unknown = node.any[0]?.data;
    if (typeof data !== 'object' || data === null) return '';
    const { fgColor, bgColor, contrastRatio } = data as Record<string, unknown>;
    return ` (${String(fgColor)} on ${String(bgColor)}, ${String(contrastRatio)}:1)`;
  }
  return '';
}

function describeViolation(violation: AxeViolation): string {
  const targets = violation.nodes.map((node) =>
    node.target
      .map((part) => (Array.isArray(part) ? part.join(' >>> ') : part))
      .join(' '),
  );
  const shown = targets
    .slice(0, TARGETS_SHOWN)
    .map((target, index) =>
      index === 0 ? `${target}${measured(violation)}` : target,
    )
    .join(' | ');
  const more =
    targets.length > TARGETS_SHOWN
      ? ` (+${targets.length - TARGETS_SHOWN} more)`
      : '';
  return `${violation.id} [${violation.impact ?? 'n/a'}] ${violation.help}: ${shown}${more}`;
}
