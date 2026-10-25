import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { localDate } from '@core/testing';
import { describe, expect, it } from 'vitest';
import { cssRule } from '../../testing/css-rule';
import { MEDALS, tileOf } from '../../testing/client-pages.vm-fixtures';
import type { AchievementTileVm } from '../client-pages.vm';
import { AchievementTile } from './achievement-tile';
import { AchievementScope } from '../client-card.contracts';

/** Earned, in progress towards III, not new. */
const FADE = tileOf(MEDALS.fade);
/** In progress to the first level: a partial arc, no numeral. */
const SATURDAY = tileOf(MEDALS.saturday);
/** Not started: the dashed silhouette. */
const REFERRAL = tileOf(MEDALS.referral);
/** Every level won: the full ring. */
const WELCOME = tileOf(MEDALS.welcome);
/** A level earned since the previous visit: «Ново». */
const NEW_FADE: AchievementTileVm = tileOf({ ...MEDALS.fade, isNew: true });
/** A busy day of «Последни» (an archived day scope): the DS stack. */
const DAY: AchievementTileVm = {
  key: '2026-09-28',
  medal: { ...MEDALS.welcome, title: 'В ритъм +2', caption: '28.09' },
  opens: {
    achievementScope: AchievementScope.Day,
    day: localDate('2026-09-28'),
  },
};

@Component({
  imports: [AchievementTile],
  template: `
    <div role="list">
      <lib-achievement-tile
        [tile]="tile()"
        [caption]="caption()"
        testId="achievements-probe"
        newWord="Ново"
        (open)="opened.push($event)"
      />
    </div>
  `,
})
class Host {
  readonly tile = signal<AchievementTileVm>(FADE);
  readonly caption = signal(true);
  readonly opened: AchievementTileVm[] = [];
}

async function mount(tile: AchievementTileVm, caption = true) {
  await TestBed.configureTestingModule({
    imports: [Host],
    errorOnUnknownElements: true,
    errorOnUnknownProperties: true,
  }).compileComponents();
  const fixture = TestBed.createComponent(Host);
  fixture.componentInstance.tile.set(tile);
  fixture.componentInstance.caption.set(caption);
  fixture.detectChanges();
  await fixture.whenStable();
  const host = fixture.nativeElement as HTMLElement;
  const medal = host.querySelector<HTMLButtonElement>(
    '[data-testid="achievements-probe"]',
  );
  return {
    fixture,
    host,
    tile: host.querySelector<HTMLElement>('lib-achievement-tile'),
    medal,
    ring: medal?.querySelector<HTMLElement>('ui-gauge.ui-medal__ring') ?? null,
    marker: host.querySelector<HTMLElement>(
      '[data-testid="achievements-probe-marker"]',
    ),
    text: (element: Element | null | undefined) =>
      element?.textContent?.replace(/\s+/g, ' ').trim() ?? null,
  };
}

describe('AchievementTile (§2.3.2 AF, AL; §3.8, §3.15)', () => {
  it('is the list item, and draws the family as one large medal button in its RING that fills its slot', async () => {
    const { tile, medal, ring, text } = await mount(FADE);
    expect(tile?.getAttribute('role')).toBe('listitem');
    expect(medal?.tagName).toBe('BUTTON');
    expect(medal?.getAttribute('type')).toBe('button');
    expect(medal?.classList.contains('ui-medal')).toBe(true);
    expect(medal?.getAttribute('data-control-size')).toBe('large');
    expect(medal?.getAttribute('data-state')).toBe('earned');
    expect(medal?.hasAttribute('data-interactive')).toBe(true);
    expect(medal?.hasAttribute('data-tile')).toBe(true);
    // ≙ .frame(maxWidth: .infinity): the whole slot is the target.
    expect(medal?.style.inlineSize).toBe('100%');
    expect(medal?.getAttribute('aria-label')).toBe(FADE.medal.accessibleName);
    // The ring is the DS's circular gauge round the disc, presentational:
    // the arc from the last threshold won to the next, no meter under it.
    expect(ring?.getAttribute('data-gauge-style')).toBe('circularCapacity');
    expect(ring?.getAttribute('aria-hidden')).toBe('true');
    expect(ring?.getAttribute('aria-valuenow')).toBe('0.92');
    expect(ring?.hasAttribute('data-extent')).toBe(false);
    expect(medal?.querySelector('.ui-medal__meter')).toBeNull();
    // The rim numeral, the face, the words.
    expect(text(medal?.querySelector('.ui-medal__level'))).toBe('II');
    expect(text(medal?.querySelector('.ui-medal__monogram'))).toBe('Ф');
    expect(text(medal?.querySelector('.ui-medal__title'))).toBe('Фейд');
    expect(text(medal?.querySelector('.ui-medal__caption'))).toBe(
      '23/25 до III',
    );
    // One family, one disc: only a day group is a stack.
    expect(medal?.hasAttribute('data-stacked')).toBe(false);
  });

  it('draws the four states by FORM: a partial arc, a dashed silhouette, a full ring', async () => {
    const partial = await mount(SATURDAY);
    expect(partial.medal?.getAttribute('data-state')).toBe('inProgress');
    expect(partial.ring?.getAttribute('aria-valuenow')).toBe(String(2 / 3));
    expect(partial.medal?.querySelector('.ui-medal__level')).toBeNull();

    TestBed.resetTestingModule();
    const silhouette = await mount(REFERRAL);
    expect(silhouette.medal?.getAttribute('data-state')).toBe('notStarted');
    // The track alone, dashed; the requirement is never hidden.
    expect(silhouette.ring?.getAttribute('data-extent')).toBe('dashed');
    expect(
      silhouette.text(silhouette.medal?.querySelector('.ui-medal__caption')),
    ).toBe('0/1 до I');

    TestBed.resetTestingModule();
    const complete = await mount(WELCOME);
    expect(complete.medal?.getAttribute('data-state')).toBe('complete');
    expect(complete.ring?.hasAttribute('data-complete')).toBe(true);
    expect(
      complete.text(complete.medal?.querySelector('.ui-medal__level')),
    ).toBe('I');
  });

  it('keeps the caption on a grid, and drops it for the glance ([caption]="false")', async () => {
    const grid = await mount(FADE, true);
    expect(grid.medal?.querySelector('.ui-medal__caption')).not.toBeNull();
    TestBed.resetTestingModule();
    const glance = await mount(FADE, false);
    expect(glance.medal?.querySelector('.ui-medal__caption')).toBeNull();
    expect(glance.text(glance.medal?.querySelector('.ui-medal__title'))).toBe(
      'Фейд',
    );
  });

  it('carries no decoration on a family that is not new', async () => {
    const { marker, medal } = await mount(FADE);
    expect(marker).toBeNull();
    expect(medal?.querySelector('.ui-badge')).toBeNull();
  });

  it('marks a level earned since the previous visit with the quiet «Ново» in the band over the ring', async () => {
    const { marker, medal } = await mount(NEW_FADE);
    expect(marker?.textContent?.trim()).toBe('Ново');
    expect(marker?.hasAttribute('uimedalmarker')).toBe(true);
    expect(marker?.getAttribute('data-tone')).toBe('accent');
    expect(marker?.getAttribute('aria-hidden')).toBe('true');
    expect(marker?.parentElement?.classList).toContain('ui-medal__marker');
    // One word: never a count on the disc beside it.
    expect(medal?.querySelectorAll('.ui-badge')).toHaveLength(1);
  });

  it('draws a day group as the DS stack — a ring behind the day’s newest — so it never reads as one family', async () => {
    const { medal, text } = await mount(DAY);
    expect(medal?.hasAttribute('data-stacked')).toBe(true);
    // What on the title line, when on the caption line.
    expect(text(medal?.querySelector('.ui-medal__title'))).toBe('В ритъм +2');
    expect(text(medal?.querySelector('.ui-medal__caption'))).toBe('28.09');
    expect(medal?.querySelectorAll('.ui-medal__disc')).toHaveLength(1);
  });

  it('hands the tile to its page on a tap', async () => {
    const { fixture, medal } = await mount(DAY);
    medal?.click();
    expect(fixture.componentInstance.opened).toEqual([DAY]);
  });

  it('is an origin the editor can focus again, clear of the bar and the dock (the stylesheet is the contract)', () => {
    expect(
      cssRule(
        'client-achievements/achievement-tile.css',
        '.achievement-tile__medal',
      ).get('scroll-margin-block'),
    ).toBe('var(--modal-sheet-origin-margin)');
    // No display of its own: the DS lays the host on its row's tracks.
    expect(
      cssRule('client-achievements/achievement-tile.css', ':host').has(
        'display',
      ),
    ).toBe(false);
  });
});
