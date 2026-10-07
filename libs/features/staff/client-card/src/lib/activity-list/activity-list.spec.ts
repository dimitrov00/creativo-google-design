import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { must } from '../../testing/client-card.fixtures';
import {
  ACTIVITY_GROUPS,
  ACTIVITY_ROW,
} from '../../testing/client-pages.vm-fixtures';
import { cssRule } from '../../testing/css-rule';
import type { ActivityGroupVm } from '../client-pages.vm';
import { ActivityList, type ActivityHeadingLevel } from './activity-list';

@Component({
  imports: [ActivityList],
  template: `<lib-activity-list
    [groups]="groups()"
    [testIdPrefix]="prefix()"
    [headingLevel]="level()"
  />`,
})
class Host {
  readonly groups = signal<readonly ActivityGroupVm[]>(
    ACTIVITY_GROUPS.newestFive,
  );
  readonly prefix = signal('rewards-ledger');
  readonly level = signal<ActivityHeadingLevel>(4);
}

interface MountOptions {
  readonly groups?: readonly ActivityGroupVm[];
  readonly prefix?: string;
  readonly level?: ActivityHeadingLevel;
}

function mount(options: MountOptions = {}) {
  TestBed.configureTestingModule({
    imports: [Host],
    errorOnUnknownElements: true,
    errorOnUnknownProperties: true,
  });
  const fixture = TestBed.createComponent(Host);
  if (options.groups !== undefined) {
    fixture.componentInstance.groups.set(options.groups);
  }
  if (options.prefix !== undefined) {
    fixture.componentInstance.prefix.set(options.prefix);
  }
  if (options.level !== undefined) {
    fixture.componentInstance.level.set(options.level);
  }
  fixture.detectChanges();
  const host = fixture.nativeElement as HTMLElement;
  const byId = <T extends HTMLElement = HTMLElement>(id: string) =>
    host.querySelector<T>(`[data-testid="${id}"]`);
  const text = (element: Element | null | undefined) =>
    element?.textContent?.replace(/\s+/g, ' ').trim() ?? null;
  return { fixture, host, byId, text };
}

describe('lib-activity-list — the statement', () => {
  it('groups the rows by month under a quiet header, and prints the net only for a month read whole', () => {
    const { host, byId, text } = mount();
    expect(host.querySelectorAll('.activity-list__month')).toHaveLength(4);
    const september = must(byId('rewards-ledger-month-2026-09'));
    const heading = must(september.querySelector('h4'));
    expect(text(heading)).toBe('Септември 2026 г.');
    expect(heading.hasAttribute('uititle')).toBe(true);
    expect(
      heading
        .closest('ui-section-header')
        ?.getAttribute('data-header-prominence'),
    ).toBe('standard');
    const net = must(byId('rewards-ledger-month-2026-09-net'));
    expect(text(net)).toBe('+27 т.');
    expect(net.hasAttribute('uisectiondetail')).toBe(true);
    // June is cut by the page boundary: its net is nobody's.
    expect(byId('rewards-ledger-month-2026-06')).not.toBeNull();
    expect(byId('rewards-ledger-month-2026-06-net')).toBeNull();
    // Each month's list is named by its heading.
    const list = must(september.querySelector('ul'));
    expect(list.classList).toContain('ui-list-group');
    expect(list.getAttribute('aria-labelledby')).toBe(heading.id);
    expect(list.querySelectorAll('li')).toHaveLength(2);
  });

  it('draws one event as one regular leading row: the white disc, the event head, the signed amount over the balance after', () => {
    const { byId, text } = mount();
    const row = must(byId('rewards-ledger-entry-entry-0905-visit'));
    expect(row.tagName).toBe('LI');
    expect(row.getAttribute('data-size')).toBe('regular');
    expect(row.getAttribute('data-alignment')).toBe('leading');
    expect(row.getAttribute('data-trailing-prominence')).toBe('primary');
    expect(row.hasAttribute('data-label-wraps')).toBe(true);
    expect(row.hasAttribute('data-struck')).toBe(false);

    const disc = must(row.querySelector('[uileading]'));
    expect(disc.classList).toContain('activity-list__disc');
    expect(disc.getAttribute('data-tone')).toBe('accent');
    expect(disc.getAttribute('aria-hidden')).toBe('true');
    const glyph = must(byId('rewards-ledger-entry-entry-0905-visit-icon'));
    expect(glyph.tagName).toBe('UI-ICON');
    expect(glyph.getAttribute('data-name')).toBe('loyalty.activity.visit');
    expect(glyph.classList).toContain('activity-list__glyph');

    const head = must(row.querySelector('lib-staff-event-head'));
    expect(head.getAttribute('data-size')).toBe('regular');
    expect(head.getAttribute('aria-hidden')).toBe('true');
    expect(text(head.querySelector('.staff-event-head__title'))).toBe(
      'Фейд · Оформяне на брада',
    );
    expect(text(head)).toContain('5.09 · Иван');

    const trailing = must(row.querySelector('[uitrailing]'));
    expect(trailing.classList).toContain('activity-list__trailing');
    expect(trailing.getAttribute('aria-hidden')).toBe('true');
    const amount = must(trailing.querySelector('.activity-list__amount'));
    expect(text(amount)).toBe('+27 т.');
    expect(amount.getAttribute('data-font')).toBe('callout');
    expect(amount.getAttribute('data-weight')).toBe('semibold');
    // The sign carries the direction: no tone, no accent, on the figure.
    expect(amount.hasAttribute('data-foreground-style')).toBe(false);
    const balance = must(trailing.querySelector('.activity-list__balance'));
    expect(text(balance)).toBe('371 т.');
    expect(balance.getAttribute('data-font')).toBe('caption');
    expect(balance.getAttribute('data-foreground-style')).toBe('secondary');
  });

  it('prints no figure for an event that moved no points', () => {
    const { byId } = mount();
    const row = must(byId('rewards-ledger-entry-entry-0902-tier'));
    expect(row.querySelector('[uitrailing]')).toBeNull();
    expect(
      byId('rewards-ledger-entry-entry-0902-tier-icon')?.getAttribute(
        'data-name',
      ),
    ).toBe('loyalty.activity.tier');
  });

  it('inks the glyph of what the shop took or corrected in the primary ink, and strikes a row a later entry reversed', () => {
    const { byId } = mount({ groups: ACTIVITY_GROUPS.everyKind });
    const redeemed = must(byId('rewards-ledger-entry-entry-1231-expired'));
    expect(
      redeemed.querySelector('.activity-list__disc')?.getAttribute('data-tone'),
    ).toBe('neutral');
    const struck = must(byId('rewards-ledger-entry-entry-0404-visit'));
    expect(struck.hasAttribute('data-struck')).toBe(true);
    expect(
      struck.querySelector('lib-staff-event-head')?.hasAttribute('data-struck'),
    ).toBe(true);
    // The reversal keeps a row of its own, not struck.
    const reversal = must(byId('rewards-ledger-entry-entry-0405-reversal'));
    expect(reversal.hasAttribute('data-struck')).toBe(false);
    expect(
      byId('rewards-ledger-entry-entry-0405-reversal-icon')?.getAttribute(
        'data-name',
      ),
    ).toBe('loyalty.activity.reversed');
    expect(
      reversal.querySelector('.activity-list__disc')?.getAttribute('data-tone'),
    ).toBe('neutral');
  });

  it('speaks each row as its one sentence and hides every drawn part from a reader', () => {
    const { byId, text } = mount();
    const row = must(byId('rewards-ledger-entry-entry-0905-visit'));
    const spoken = must(row.querySelector('[uivisuallyhidden]'));
    expect(text(spoken)).toBe(ACTIVITY_ROW.visit.accessibleName);
    for (const part of row.querySelectorAll(
      '[uileading], lib-staff-event-head, [uitrailing]',
    )) {
      expect(part.getAttribute('aria-hidden')).toBe('true');
    }
  });

  it('takes the heading level the page asks for: h3 on the ledger page, h4 under a section heading', () => {
    const { host, byId } = mount({ level: 3, prefix: 'ledger' });
    expect(host.querySelectorAll('h3')).toHaveLength(4);
    expect(host.querySelector('h4')).toBeNull();
    expect(byId('ledger-month-2026-09')).not.toBeNull();
    expect(byId('ledger-entry-entry-0905-visit')).not.toBeNull();
  });

  it('draws nothing for no month', () => {
    const { host } = mount({ groups: [] });
    expect(host.querySelector('.activity-list__month')).toBeNull();
  });

  it('reads its stylesheet as a contract: a 36 white disc, and the accent on the glyph alone', () => {
    expect(
      cssRule('activity-list/activity-list.css', '.activity-list__disc'),
    ).toEqual(
      new Map([
        ['inline-size', 'var(--control-size-small)'],
        ['block-size', 'var(--control-size-small)'],
        ['border-radius', 'var(--control-radius-capsule)'],
        ['background', 'var(--sys-color-surface-elevated)'],
      ]),
    );
    // The accent as `color` ends in a glyph selector (the law's rule 5a).
    expect(
      cssRule(
        'activity-list/activity-list.css',
        ".activity-list__disc[data-tone='accent'] .activity-list__glyph",
      ),
    ).toEqual(new Map([['color', 'var(--sys-color-accent)']]));
    expect(cssRule('activity-list/activity-list.css', ':host').get('gap')).toBe(
      'var(--sys-space-comfortable)',
    );
  });
});
