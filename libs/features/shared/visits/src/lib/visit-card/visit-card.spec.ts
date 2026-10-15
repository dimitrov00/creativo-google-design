import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { loyaltyFixtures } from '@creativo/application/engagement/testing';
import type { UiCardPadding, UiCardTone } from '@creativo/ui/controls';
import { appCatalogue } from '../testing/app-catalogue';
import { cssRule } from '../testing/css-rule';
import {
  GEORGI_PHOTOS,
  GEORGI_UID,
  GEORGI_VISITS,
  VISITS_LOOKUP,
  catalogueTranslator,
  georgiWaitlistRequest,
  visitsNowMs,
} from '../testing/visit-fixtures';
import { visitWaitlistWordsOf, visitWordsOf } from '../visit-row.presenter';
import { VisitCard, type VisitCardHeaderProminence } from './visit-card';
import { visitCardOf, waitlistCardOf } from './visit-card.presenter';
import type { VisitCardVm } from './visit-card.vm';

/*
 * THE DRAWING of `lib-visit-card` (revision 3 §3.10). Its public API is
 * pinned apart, by metadata (`visit-card.contract.spec.ts`); its builders
 * have their own spec (`visit-card.presenter.spec.ts`). Here the cards are
 * the ones the builders really build, from Георги Петров's book and the
 * app's own catalogue, and a hand-built one where a case needs a fact the
 * book does not hold.
 *
 * jsdom lays nothing out, so where a case pins HOW a part is laid out the
 * stylesheet is the contract; the live card was measured in Chromium at
 * 330, 390 and 576, in both themes (the heights in the comments below).
 */

const BG = catalogueTranslator(appCatalogue('bg'));
const STAFF_WORDS = {
  ...visitWordsOf(BG, 'bg', 'staff'),
  statusConfirmed: BG('appointments.status.confirmed'),
};
const CLIENT_WORDS = {
  ...visitWordsOf(BG, 'bg', 'client'),
  statusConfirmed: BG('appointments.status.confirmed'),
};
const CARD_WORDS = {
  last: BG('visits.card.last'),
  next: BG('visits.card.next'),
  name: (label: string, sentence: string) =>
    BG('visits.card.name', { label, sentence }),
};
const NOW_MS = visitsNowMs(loyaltyFixtures.today);
const CSS = readFileSync(resolve(__dirname, 'visit-card.css'), 'utf8');
const NBSP = ' ';

function visit(id: string) {
  const found = GEORGI_VISITS.find((each) => each.id === id);
  if (found === undefined) throw new Error(`no visit ${id}`);
  return found;
}

/** Георги's last visit as the glance draws it: his words, the visit's own photo. */
function lastVisit(): VisitCardVm {
  return visitCardOf(
    visit('appt-sep'),
    {
      kind: 'last',
      perspective: 'staff',
      subjectUserId: GEORGI_UID,
      nowMs: NOW_MS,
      locale: 'bg',
      words: STAFF_WORDS,
      cardWords: CARD_WORDS,
      photos: GEORGI_PHOTOS.filter(
        (photo) => photo.appointmentId === 'appt-sep',
      ).map((photo) => ({
        id: photo.id as string,
        url: photo.url,
        takenAtUtcMs: photo.takenAtUtcMs,
      })),
      testId: 'client-visit-last',
    },
    VISITS_LOOKUP,
  );
}

/** The visit after this one: requested online, not yet confirmed. */
function nextVisit(): VisitCardVm {
  return visitCardOf(
    visit('appt-oct'),
    {
      kind: 'next',
      perspective: 'staff',
      subjectUserId: GEORGI_UID,
      nowMs: NOW_MS,
      locale: 'bg',
      words: STAFF_WORDS,
      cardWords: CARD_WORDS,
      testId: 'client-visit-next',
    },
    VISITS_LOOKUP,
  );
}

function waitingRequest(): VisitCardVm {
  return waitlistCardOf(
    georgiWaitlistRequest(),
    {
      words: visitWaitlistWordsOf(BG),
      today: loyaltyFixtures.today,
      locale: 'bg',
      otherRequests: 1,
      testId: 'client-visit-waitlist',
    },
    VISITS_LOOKUP,
  );
}

/** `/account`'s «Предстоящ час», as the page mounts it. */
function upcoming(): VisitCardVm {
  return visitCardOf(
    visit('appt-oct'),
    {
      kind: 'next',
      perspective: 'client',
      subjectUserId: null,
      nowMs: NOW_MS,
      locale: 'bg',
      words: CLIENT_WORDS,
      cardWords: CARD_WORDS,
      label: BG('account.upcoming.title'),
      barber: false,
      testId: 'account-upcoming',
    },
    VISITS_LOOKUP,
  );
}

@Component({
  imports: [VisitCard],
  template: `
    <lib-visit-card
      [vm]="vm()"
      [headerProminence]="headerProminence()"
      [tone]="tone()"
      [padding]="padding()"
      [interactive]="interactive()"
      [showServices]="showServices()"
      (open)="opened.push(vm().id)"
      (openPhoto)="photos.push($event)"
    />
  `,
})
class Host {
  readonly vm = signal<VisitCardVm>(null as unknown as VisitCardVm);
  readonly headerProminence = signal<VisitCardHeaderProminence>('standard');
  readonly tone = signal<UiCardTone>('elevated');
  readonly padding = signal<UiCardPadding>('comfortable');
  readonly interactive = signal(false);
  readonly showServices = signal(true);
  readonly opened: string[] = [];
  readonly photos: string[] = [];
}

interface Mounting {
  readonly headerProminence?: VisitCardHeaderProminence;
  readonly tone?: UiCardTone;
  readonly padding?: UiCardPadding;
  readonly interactive?: boolean;
  readonly showServices?: boolean;
}

async function mount(vm: VisitCardVm, as: Mounting = {}) {
  await TestBed.configureTestingModule({
    imports: [Host],
    errorOnUnknownElements: true,
    errorOnUnknownProperties: true,
  }).compileComponents();
  const fixture = TestBed.createComponent(Host);
  const host = fixture.componentInstance;
  host.vm.set(vm);
  host.headerProminence.set(as.headerProminence ?? 'standard');
  host.tone.set(as.tone ?? 'elevated');
  host.padding.set(as.padding ?? 'comfortable');
  host.interactive.set(as.interactive ?? false);
  host.showServices.set(as.showServices ?? true);
  fixture.detectChanges();
  const root = fixture.nativeElement as HTMLElement;
  const q = <T extends HTMLElement = HTMLElement>(selector: string) =>
    root.querySelector<T>(selector);
  const all = <T extends HTMLElement = HTMLElement>(selector: string) => [
    ...root.querySelectorAll<T>(selector),
  ];
  /** The words as the eye reads them: every space a plain one. */
  const text = (selector: string) =>
    q(selector)?.textContent?.replace(/\s+/g, ' ').trim() ?? null;
  return { fixture, host, root, q, all, text };
}

describe('VisitCard · the card to read (the staff glance)', () => {
  it('is a white lifted card: the DS surface, elevated, padded 24, named by the host', async () => {
    const { q } = await mount(lastVisit());

    const card = q('[data-testid="client-visit-last"]');
    expect(card?.tagName).toBe('UI-CARD');
    expect(card?.classList.contains('ui-card')).toBe(true);
    expect(card?.getAttribute('data-tone')).toBe('elevated');
    expect(card?.getAttribute('data-padding')).toBe('comfortable');
    // To read, not to press: no state layer, no pointer.
    expect(card?.hasAttribute('data-interactive')).toBe(false);
    expect(q('lib-visit-card button.ui-card')).toBeNull();

    const host = q('lib-visit-card');
    expect(host?.getAttribute('data-kind')).toBe('last');
    expect(host?.getAttribute('data-header-prominence')).toBe('standard');
  });

  it('is a group named by its one sentence, which is real text in the reading order', async () => {
    const vm = lastVisit();
    const { q } = await mount(vm);

    const card = q('[data-testid="client-visit-last"]');
    expect(card?.getAttribute('role')).toBe('group');
    const name = q('[data-visually-hidden]');
    expect(name?.textContent?.trim()).toBe(vm.accessibleName);
    expect(name?.id).toMatch(/^visit-card-name-\d+$/);
    expect(card?.getAttribute('aria-labelledby')).toBe(name?.id);
    // The sentence leads the card, before anything drawn.
    expect(card?.firstElementChild).toBe(name);
  });

  it('hides the drawn words from the reader, so nothing is heard twice', async () => {
    const { q } = await mount(nextVisit());

    expect(q('.visit-card__words')?.getAttribute('aria-hidden')).toBe('true');
    expect(q('.visit-card__capsule')?.getAttribute('aria-hidden')).toBe('true');
    // Every drawn word sits inside a hidden part…
    for (const part of [
      '.visit-card__label',
      '.visit-card__services',
      '.visit-card__line',
      '.visit-card__face',
    ]) {
      expect(q(part)?.closest('[aria-hidden="true"]')).not.toBeNull();
    }
    // …and the sentence itself never does.
    expect(q('[data-visually-hidden]')?.closest('[aria-hidden]')).toBeNull();
  });

  it('gives two cards on one page two names', async () => {
    const first = await mount(lastVisit());
    const firstId = first.q('[data-visually-hidden]')?.id;
    TestBed.resetTestingModule();
    const second = await mount(nextVisit());
    const secondId = second.q('[data-visually-hidden]')?.id;
    expect(firstId).not.toBe(secondId);
  });

  it('reads in ONE order: the label, the services, the facts, the client’s words; then the thumbs', async () => {
    const { q, all, text } = await mount(lastVisit());

    expect(text('.visit-card__label')).toBe('Последно посещение');
    expect(text('.visit-card__services')).toBe('Фейд');
    expect(text('.visit-card__line')).toBe('4.09 · Иван · Център');
    expect(text('.visit-card__figure')).toBe('27,50 €');
    expect(text('.visit-card__quote')).toBe('„Къса отстрани, по-дълго отгоре“');

    const words = q('.visit-card__words');
    expect([...(words?.children ?? [])].map((part) => part.className)).toEqual([
      'visit-card__head',
      'visit-card__facts',
      'visit-card__quote',
    ]);
    expect(
      all('.visit-card__titles > *').map((part) => part.className),
    ).toEqual(['visit-card__label', 'visit-card__services']);
    // The card's own children: the sentence, the words, the thumbs.
    const card = q('[data-testid="client-visit-last"]');
    expect(
      [...(card?.children ?? [])].map(
        (part) => part.className || part.getAttribute('id'),
      ),
    ).toEqual([
      q('[data-visually-hidden]')?.id,
      'visit-card__words',
      'visit-card__thumbs',
    ]);
  });

  it('reads a next visit the same way, its capsule last', async () => {
    const { q, text } = await mount(nextVisit());

    expect(text('.visit-card__label')).toBe('Следващ час');
    expect(text('.visit-card__services')).toBe('Фейд');
    expect(text('.visit-card__line')).toBe('пт, 2.10 · 10:00 · Иван');
    expect(q('.visit-card__figure')).toBeNull();
    expect(q('.visit-card__quote')).toBeNull();
    expect(q('.visit-card__thumbs')).toBeNull();
    const card = q('[data-testid="client-visit-next"]');
    expect(card?.lastElementChild).toBe(q('.visit-card__capsule'));
  });

  it('sets the type by role: a quiet label, the services as the headline, a quiet line', async () => {
    const { q } = await mount(lastVisit());

    const label = q('.visit-card__label');
    expect(label?.getAttribute('data-font')).toBe('subheadline');
    expect(label?.getAttribute('data-foreground-style')).toBe('secondary');

    const services = q('.visit-card__services');
    expect(services?.getAttribute('data-font')).toBe('headline');
    // The role's own ink and weight: primary, 600.
    expect(services?.hasAttribute('data-foreground-style')).toBe(false);
    expect(services?.hasAttribute('data-weight')).toBe(false);

    const line = q('.visit-card__line');
    expect(line?.getAttribute('data-font')).toBe('callout');
    expect(line?.getAttribute('data-foreground-style')).toBe('secondary');

    const figure = q('.visit-card__figure');
    expect(figure?.getAttribute('data-font')).toBe('callout');
    expect(figure?.getAttribute('data-weight')).toBe('semibold');
    expect(figure?.getAttribute('data-foreground-style')).toBe('primary');

    const quote = q('.visit-card__quote');
    expect(quote?.getAttribute('data-font')).toBe('callout');
    expect(quote?.hasAttribute('data-foreground-style')).toBe(false);
  });

  it('sets ONE fact apart in the quiet line: the date of a last visit, the time of a next one', async () => {
    const last = await mount(lastVisit());
    const lastFacts = last.all('.visit-card__run[data-fact]');
    expect(lastFacts.map((run) => run.textContent)).toEqual(['4.09']);
    expect(lastFacts[0]?.getAttribute('data-foreground-style')).toBe('primary');
    expect(lastFacts[0]?.getAttribute('data-weight')).toBe('medium');
    // The runs beside it inherit the line's quiet ink.
    for (const run of last.all('.visit-card__run:not([data-fact])')) {
      expect(run.hasAttribute('data-foreground-style')).toBe(false);
      expect(run.hasAttribute('data-weight')).toBe(false);
    }

    TestBed.resetTestingModule();
    const next = await mount(nextVisit());
    expect(
      next.all('.visit-card__run[data-fact]').map((run) => run.textContent),
    ).toEqual(['10:00']);
  });

  it('sets nothing between the runs: the line is the runs, joint for joint', async () => {
    const vm = nextVisit();
    const { q, all } = await mount(vm);
    const runs = all('.visit-card__run');
    expect(runs).toHaveLength(vm.facts.length);
    // No text node of the template's own between them.
    expect(
      [...(q('.visit-card__line')?.childNodes ?? [])].filter(
        (node) => node.nodeType === Node.TEXT_NODE,
      ),
    ).toEqual([]);
  });

  it('hangs a joint from the word before it, so no line ever starts with «·»', async () => {
    const vm: VisitCardVm = {
      ...lastVisit(),
      services: 'Фейд · Оформяне на брада · Кралско бръснене',
    };
    const { q, all } = await mount(vm);
    expect(q('.visit-card__services')?.textContent).toBe(
      `Фейд${NBSP}· Оформяне на брада${NBSP}· Кралско бръснене`,
    );
    expect(all('.visit-card__run').map((run) => run.textContent)).toEqual([
      '4.09',
      `${NBSP}· Иван${NBSP}· Център`,
    ]);
    // The view model keeps the row's plain joint: only the drawing hangs it.
    expect(vm.facts[1]?.text).toBe(' · Иван · Център');
  });

  it('draws the barber’s face in the corner of the head, at the regular rung', async () => {
    const vm = lastVisit();
    const { q } = await mount(vm);
    const face = q('.visit-card__face');
    expect(face?.tagName).toBe('UI-AVATAR');
    expect(face?.getAttribute('data-control-size')).toBe('regular');
    expect(face?.parentElement).toBe(q('.visit-card__head'));
    // After the words in the head: the trailing corner.
    expect(q('.visit-card__head')?.lastElementChild).toBe(face);
    expect(face?.querySelector('img')?.getAttribute('src')).toBe(
      vm.barber?.avatarSrc,
    );
  });

  it('draws initials for a barber with no picture, and no face where the card names none', async () => {
    const named = await mount({
      ...lastVisit(),
      barber: { name: 'Петър Станев', avatarSrc: null },
    });
    expect(
      named.q('.visit-card__face .ui-avatar__fallback')?.textContent?.trim(),
    ).toBe('ПС');
    expect(named.q('.visit-card__face img')).toBeNull();

    TestBed.resetTestingModule();
    const none = await mount({ ...lastVisit(), barber: null });
    expect(none.q('.visit-card__face')).toBeNull();
    expect(none.q('ui-avatar')).toBeNull();
  });

  it('wears a status as a DS capsule that names itself to a test', async () => {
    const { q, text } = await mount(nextVisit());
    const capsule = q('[data-testid="client-visit-next-status"]');
    expect(capsule?.tagName).toBe('SPAN');
    expect(capsule?.classList.contains('ui-badge')).toBe(true);
    expect(capsule?.getAttribute('data-tone')).toBe('accent');
    expect(capsule?.getAttribute('data-prominence')).toBe('standard');
    expect(text('.visit-card__capsule')).toBe('Заявен');
  });

  it('draws no capsule on a last visit, and none on a waiting request', async () => {
    const last = await mount(lastVisit());
    expect(last.q('.ui-badge')).toBeNull();
    TestBed.resetTestingModule();
    const waiting = await mount(waitingRequest());
    expect(waiting.q('.ui-badge')).toBeNull();
  });

  it('names the quote for a test by the card’s own id', async () => {
    const { q } = await mount(lastVisit());
    expect(q('[data-testid="client-visit-last-quote"]')).toBe(
      q('.visit-card__quote'),
    );
  });

  it('draws a waiting request as a card of the same order: its state, the services, the days', async () => {
    const vm = waitingRequest();
    const { q, text } = await mount(vm);

    expect(q('lib-visit-card')?.getAttribute('data-kind')).toBe('waitlist');
    expect(q('[data-testid="client-visit-waitlist"]')).not.toBeNull();
    expect(text('.visit-card__label')).toBe('Чака свободен час');
    expect(text('.visit-card__services')).toBe('Фейд');
    expect(text('.visit-card__line')).toBe('чт – пт, следобед · още 1');
    // Nothing is booked, so no date is THE date.
    expect(q('.visit-card__run[data-fact]')).toBeNull();
    expect(q('.visit-card__face')).toBeNull();
    expect(q('.visit-card__figure')).toBeNull();
    expect(q('[data-visually-hidden]')?.textContent?.trim()).toBe(
      vm.accessibleName,
    );
  });

  it('draws no facts line for a card with no fact and no figure', async () => {
    const { q } = await mount({ ...waitingRequest(), facts: [] });
    expect(q('.visit-card__facts')).toBeNull();
    expect(q('.visit-card__line')).toBeNull();
  });

  it('takes the surface and the padding its host asks for', async () => {
    const { q } = await mount(nextVisit(), {
      tone: 'plain',
      padding: 'regular',
    });
    const card = q('[data-testid="client-visit-next"]');
    expect(card?.getAttribute('data-tone')).toBe('plain');
    expect(card?.getAttribute('data-padding')).toBe('regular');
  });

  it('follows its view model: the next card in the same place', async () => {
    const { fixture, host, q, text } = await mount(lastVisit());
    host.vm.set(nextVisit());
    fixture.detectChanges();
    expect(q('[data-testid="client-visit-last"]')).toBeNull();
    expect(q('[data-testid="client-visit-next"]')).not.toBeNull();
    expect(q('lib-visit-card')?.getAttribute('data-kind')).toBe('next');
    expect(text('.visit-card__label')).toBe('Следващ час');
    expect(q('.visit-card__thumbs')).toBeNull();
    expect(q('.visit-card__capsule')).not.toBeNull();
  });
});

describe('VisitCard · the thumbs', () => {
  function withPhotos(count: number): VisitCardVm {
    return {
      ...lastVisit(),
      photos: Array.from({ length: count }, (_, index) => ({
        id: `photo-${index + 1}`,
        url: `https://example.test/photos/photo-${index + 1}.jpg`,
        alt: `Снимка от ${index + 4} септември`,
      })),
    };
  }

  it('shows the visit’s own photo as a square thumb that opens the picture', async () => {
    const { fixture, host, all } = await mount(lastVisit());

    const thumbs = all<HTMLButtonElement>('.visit-card__thumb');
    expect(thumbs.map((thumb) => thumb.getAttribute('data-testid'))).toEqual([
      'client-visit-photo-photo-sep-1',
    ]);
    const thumb = thumbs[0];
    expect(thumb?.tagName).toBe('BUTTON');
    expect(thumb?.getAttribute('type')).toBe('button');
    expect(thumb?.getAttribute('aria-label')).toBe('Снимка от 4 септември');
    // The house press and hover, and the DS's own shape.
    expect(thumb?.hasAttribute('data-interactive')).toBe(true);
    expect(thumb?.getAttribute('data-radius')).toBe('regular');
    // The picture is the button's one child: the DS resets its chrome.
    expect(thumb?.children).toHaveLength(1);
    const media = thumb?.querySelector(':scope > ui-media-card');
    expect(media?.getAttribute('data-radius')).toBe('regular');
    expect(
      media?.querySelector<HTMLElement>('ui-async-image')?.style.aspectRatio,
    ).toBe('1 / 1');
    // No grade over a picture that carries no caption.
    expect(media?.querySelector('[uioverlay]')).toBeNull();

    thumb?.click();
    fixture.detectChanges();
    expect(host.photos).toEqual(['photo-sep-1']);
    // A thumb opens the picture, never the card.
    expect(host.opened).toEqual([]);
  });

  it('keeps the thumbs to the reader: they are not among the hidden words', async () => {
    const { all } = await mount(withPhotos(3));
    const thumbs = all('.visit-card__thumb');
    expect(thumbs).toHaveLength(3);
    for (const thumb of thumbs) {
      expect(thumb.closest('[aria-hidden]')).toBeNull();
    }
  });

  it('draws no thumbs row for a visit with no photos', async () => {
    const { q } = await mount(withPhotos(0));
    expect(q('.visit-card__thumbs')).toBeNull();
    expect(q('.visit-card__thumb')).toBeNull();
  });

  it('keeps three squares on one line, 72 each, and lets them give way before they wrap', () => {
    expect(cssRule(CSS, ':host').get('--visit-card-thumb')).toBe(
      'calc(var(--sys-space-unit) * 18)',
    );
    const row = cssRule(CSS, '.visit-card__thumbs');
    expect(row.get('display')).toBe('flex');
    expect(row.has('flex-wrap')).toBe(false);
    expect(row.get('gap')).toBe('var(--sys-space-compact)');
    const thumb = cssRule(CSS, '.visit-card__thumb');
    expect(thumb.get('flex')).toBe('0 1 var(--visit-card-thumb)');
    expect(thumb.get('min-inline-size')).toBe('0');
  });

  it('lands a thumb clear of the sheet’s bar and dock when the focus comes back to it', () => {
    // A thumb pushes the photo page and is focused again on ‹: the sheet's
    // own origin clearance (ui-modal-sheet publishes it), never a hand copy.
    expect(cssRule(CSS, '.visit-card__thumb').get('scroll-margin-block')).toBe(
      'var(--modal-sheet-origin-margin)',
    );
  });
});

describe('VisitCard · the whole card a control (`interactive`)', () => {
  it('is ONE button: the DS card’s button form, named by the sentence', async () => {
    const vm = upcoming();
    const { fixture, host, q } = await mount(vm, { interactive: true });

    const card = q<HTMLButtonElement>('[data-testid="account-upcoming"]');
    expect(card?.tagName).toBe('BUTTON');
    expect(card?.getAttribute('type')).toBe('button');
    expect(card?.classList.contains('ui-card')).toBe(true);
    expect(card?.hasAttribute('data-interactive')).toBe(true);
    expect(card?.getAttribute('data-tone')).toBe('elevated');
    expect(card?.getAttribute('data-padding')).toBe('comfortable');
    expect(card?.getAttribute('aria-label')).toBe(vm.accessibleName);
    // The name is the button's: no group, no second sentence, nothing hidden.
    expect(card?.hasAttribute('role')).toBe(false);
    expect(q('[data-visually-hidden]')).toBeNull();
    expect(q('[aria-hidden="true"]')).toBeNull();

    card?.click();
    fixture.detectChanges();
    expect(host.opened).toEqual(['appt-oct']);
  });

  it('holds phrasing content only: a button may hold no block and no control', async () => {
    const { q, all } = await mount(
      { ...lastVisit(), capsule: { text: 'Потвърден', tone: 'accent' } },
      { interactive: true },
    );
    const card = q('button.visit-card');
    // The card's own parts are spans, every one (a DS part inside them —
    // the avatar, the capsule — is its own markup, as in a list row's
    // button).
    const own = [...(card?.querySelectorAll('[class*="visit-card__"]') ?? [])];
    expect(own.length).toBeGreaterThan(8);
    for (const part of own) {
      expect(['SPAN', 'UI-AVATAR']).toContain(part.tagName);
    }
    // No control inside the control.
    expect(
      card?.querySelector('button, a, input, select, textarea'),
    ).toBeNull();
    // The thumbs are there, and they are the button's siblings.
    expect(all('.visit-card__thumb')).toHaveLength(1);
    expect(card?.querySelector('.visit-card__thumb')).toBeNull();
  });

  it('sets the thumbs OUTSIDE the button, over a room the button keeps at its foot', async () => {
    const { fixture, host, q } = await mount(lastVisit(), {
      interactive: true,
    });

    const card = q('button.visit-card');
    const thumbs = q('.visit-card__thumbs');
    expect(thumbs?.hasAttribute('data-outside')).toBe(true);
    expect(thumbs?.parentElement).toBe(q('lib-visit-card'));
    expect(card?.nextElementSibling).toBe(thumbs);
    // Inset by the card's own padding, on the DS's ladder.
    expect(thumbs?.getAttribute('data-padding')).toBe('comfortable');

    const room = q('.visit-card__room');
    expect(room?.parentElement).toBe(card);
    expect(room?.getAttribute('aria-hidden')).toBe('true');
    expect(card?.lastElementChild).toBe(room);

    // Each control does its own thing.
    q<HTMLButtonElement>('.visit-card__thumb')?.click();
    fixture.detectChanges();
    expect(host.photos).toEqual(['photo-sep-1']);
    expect(host.opened).toEqual([]);
  });

  it('follows the card’s padding with the thumbs’ inset', async () => {
    const { q } = await mount(lastVisit(), {
      interactive: true,
      padding: 'regular',
    });
    expect(q('.visit-card__thumbs')?.getAttribute('data-padding')).toBe(
      'regular',
    );
  });

  it('keeps no room where there are no photos', async () => {
    const { q } = await mount(upcoming(), { interactive: true });
    expect(q('.visit-card__room')).toBeNull();
    expect(q('.visit-card__thumbs')).toBeNull();
  });

  it('lays the thumbs over the room: one cell, the card’s foot, the pictures alone take the pointer', () => {
    const host = cssRule(CSS, ':host');
    expect(host.get('display')).toBe('grid');
    expect(host.get('grid-template-columns')).toBe('minmax(0, 1fr)');
    expect(cssRule(CSS, '.visit-card').get('grid-area')).toBe('1 / 1');

    const room = cssRule(CSS, '.visit-card__room');
    expect(room.get('block-size')).toBe('var(--visit-card-thumb)');
    expect(room.get('margin-block-start')).toBe('var(--sys-space-regular)');

    const outside = cssRule(CSS, '.visit-card__thumbs[data-outside]');
    expect(outside.get('grid-area')).toBe('1 / 1');
    expect(outside.get('align-self')).toBe('end');
    // Above the card's state layer…
    expect(outside.get('position')).toBe('relative');
    expect(outside.get('z-index')).toBe('1');
    // …inset by the ladder's padding on three sides, never on top.
    expect(outside.get('padding-block-start')).toBe('0');
    expect(outside.get('margin-block-start')).toBe('0');
    // Between the pictures the card is still the target.
    expect(outside.get('pointer-events')).toBe('none');
    expect(
      cssRule(
        CSS,
        '.visit-card__thumbs[data-outside] > .visit-card__thumb',
      ).get('pointer-events'),
    ).toBe('auto');
  });

  it('emits nothing when a card to read is clicked', async () => {
    const { fixture, host, q } = await mount(lastVisit());
    q('[data-testid="client-visit-last"]')?.click();
    q('.visit-card__words')?.click();
    fixture.detectChanges();
    expect(host.opened).toEqual([]);
  });
});

describe('VisitCard · the label as the heading (`increased`, `/account`)', () => {
  it('draws exactly today’s «Предстоящ час»: the heading, the day and the time, the status', async () => {
    const { q, all, text } = await mount(upcoming(), {
      headerProminence: 'increased',
      interactive: true,
      showServices: false,
    });

    expect(q('lib-visit-card')?.getAttribute('data-header-prominence')).toBe(
      'increased',
    );
    const label = q('.visit-card__label');
    expect(label?.textContent).toBe('Предстоящ час');
    expect(label?.getAttribute('data-font')).toBe('headline');
    expect(label?.hasAttribute('data-foreground-style')).toBe(false);

    expect(q('.visit-card__services')).toBeNull();
    expect(q('.visit-card__head')?.hasAttribute('data-services')).toBe(false);

    const line = q('.visit-card__line');
    expect(text('.visit-card__line')).toBe('пт, 2.10 · 10:00');
    expect(line?.getAttribute('data-font')).toBe('body');
    // The body's own ink, one weight: the time is not set apart here.
    expect(line?.hasAttribute('data-foreground-style')).toBe(false);
    for (const run of all('.visit-card__run')) {
      expect(run.hasAttribute('data-foreground-style')).toBe(false);
      expect(run.hasAttribute('data-weight')).toBe(false);
    }

    const status = q('[data-testid="account-upcoming-status"]');
    expect(status?.classList.contains('ui-badge')).toBe(true);
    expect(status?.getAttribute('data-tone')).toBe('accent');
    expect(status?.textContent).toBe('Заявен');
    expect(q('.visit-card__face')).toBeNull();
  });

  it('keeps the page’s rhythm: the heading 8 over its line, the capsule 4 under it', () => {
    // Measured: 128.19 tall at 390 and at 330, the height of the card the
    // page draws today (24 + 23.4 + 8 + 22.5 + 4 + 22.3 + 24).
    const increased = cssRule(
      CSS,
      ":host([data-header-prominence='increased'])",
    );
    expect(increased.get('--visit-card-label-gap')).toBe(
      'var(--sys-space-compact)',
    );
    expect(increased.get('--visit-card-capsule-gap')).toBe(
      'var(--sys-space-tight)',
    );
    expect(
      cssRule(
        CSS,
        ":host([data-header-prominence='increased']) .visit-card__head:not([data-services]) + .visit-card__facts",
      ).get('margin-block-start'),
    ).toBe('var(--visit-card-label-gap)');
    expect(cssRule(CSS, '.visit-card__capsule').get('margin-block-start')).toBe(
      'var(--visit-card-capsule-gap)',
    );
  });

  it('with the services shown, sets them as the row’s title and the facts as the quiet line under it', async () => {
    const { q, all } = await mount(nextVisit(), {
      headerProminence: 'increased',
    });

    expect(q('.visit-card__label')?.getAttribute('data-font')).toBe('headline');
    const services = q('.visit-card__services');
    expect(services?.getAttribute('data-font')).toBe('body');
    expect(services?.getAttribute('data-weight')).toBe('medium');
    expect(q('.visit-card__head')?.hasAttribute('data-services')).toBe(true);

    // No two lines that touch share both size and tone (L5).
    const line = q('.visit-card__line');
    expect(line?.getAttribute('data-font')).toBe('callout');
    expect(line?.getAttribute('data-foreground-style')).toBe('secondary');
    expect(
      all('.visit-card__run[data-fact]').map((run) =>
        run.getAttribute('data-foreground-style'),
      ),
    ).toEqual(['primary']);
  });

  it('leaves the services out of a standard card too, when its host asks', async () => {
    const { q, text } = await mount(nextVisit(), { showServices: false });
    expect(q('.visit-card__services')).toBeNull();
    expect(text('.visit-card__label')).toBe('Следващ час');
    expect(q('.visit-card__line')?.getAttribute('data-font')).toBe('callout');
  });
});

describe('VisitCard · the stylesheet', () => {
  const bare = CSS.replace(/\/\*[\s\S]*?\*\//g, '');

  it('declares no colour: the card changes colour entirely through the DS', () => {
    expect(bare).not.toMatch(/(^|[\s;{])(color|background(-color)?)\s*:/);
    expect(bare).not.toMatch(/--sys-color-/);
    expect(bare).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(bare).not.toMatch(/\b(rgb|hsl|oklch|color-mix)\(/);
    expect(bare).not.toMatch(/box-shadow|border(-radius)?\s*:/);
  });

  it('sets no type: no `font` shorthand to reset the tabular figures, no size of its own', () => {
    expect(bare).not.toMatch(/(^|[\s;{])font(-size|-weight|-family)?\s*:/);
    expect(bare).not.toMatch(/line-height\s*:/);
  });

  it('fades nothing and moves nothing', () => {
    expect(bare).not.toMatch(/\bopacity\s*:/);
    expect(bare).not.toMatch(/\b(transition|animation|transform)\s*:/);
  });

  it('measures every distance on a token', () => {
    const lengths = [...bare.matchAll(/:\s*([^;{}]*\d(px|rem|em)\b[^;{}]*);/g)];
    expect(lengths.map((match) => match[1])).toEqual([]);
  });

  it('keeps the words one block, `tight` apart, and stands the rest off them', () => {
    // Measured at 390: the plain card 117.88 (§2.1.3: ≈ 117), with the
    // quote and the thumbs 230.17 (≈ 229), with a capsule 148.17 (≈ 147).
    const host = cssRule(CSS, ':host');
    expect(host.get('--visit-card-label-gap')).toBe('var(--sys-space-tight)');
    expect(host.get('--visit-card-capsule-gap')).toBe(
      'var(--sys-space-compact)',
    );
    // The DS card's own gap is between blocks of equal standing; this
    // card's parts each state their own distance.
    expect(cssRule(CSS, '.visit-card').get('gap')).toBe('0');
    expect(cssRule(CSS, '.visit-card__titles').get('row-gap')).toBe(
      'var(--visit-card-label-gap)',
    );
    expect(cssRule(CSS, '.visit-card__facts').get('margin-block-start')).toBe(
      'var(--sys-space-tight)',
    );
    expect(cssRule(CSS, '.visit-card__quote').get('margin-block-start')).toBe(
      'var(--sys-space-tight)',
    );
    expect(cssRule(CSS, '.visit-card__thumbs').get('margin-block-start')).toBe(
      'var(--sys-space-regular)',
    );
  });

  it('hangs the face from the top-trailing corner, the services wrapping beside it', () => {
    const head = cssRule(CSS, '.visit-card__head');
    expect(head.get('display')).toBe('flex');
    expect(head.get('align-items')).toBe('flex-start');
    expect(head.get('justify-content')).toBe('space-between');
    expect(head.get('column-gap')).toBe('var(--sys-space-regular)');
    expect(cssRule(CSS, '.visit-card__face').get('flex')).toBe('none');
    expect(cssRule(CSS, '.visit-card__titles').get('min-inline-size')).toBe(
      '0',
    );
  });

  it('ends the facts’ FIRST line with the money, so a line that wraps runs the whole width', async () => {
    // As a column of its own the figure held its width down every line
    // the facts wrapped to (four short lines beside «1 127,50 €» at 330).
    const { q } = await mount(lastVisit());
    const facts = q('.visit-card__facts');
    // The float comes first, so the line's first line runs round it.
    expect([...(facts?.children ?? [])].map((part) => part.className)).toEqual([
      'visit-card__figure',
      'visit-card__line',
    ]);
    expect(cssRule(CSS, '.visit-card__facts').get('display')).toBe('flow-root');
    const figure = cssRule(CSS, '.visit-card__figure');
    expect(figure.get('float')).toBe('inline-end');
    expect(figure.get('margin-inline-start')).toBe('var(--sys-space-regular)');
    expect(figure.get('white-space')).toBe('nowrap');
    expect(cssRule(CSS, '.visit-card__line').get('display')).toBe('block');
  });

  it('cuts no word short: every line wraps, none is clamped', () => {
    expect(bare).not.toMatch(/text-overflow|line-clamp/);
    expect(bare).not.toMatch(/overflow\s*:\s*hidden/);
    // Only the money keeps to one line.
    expect([...bare.matchAll(/white-space\s*:\s*nowrap/g)]).toHaveLength(1);
  });

  it('lets the capsule hug its word', () => {
    expect(cssRule(CSS, '.visit-card__capsule').get('align-self')).toBe(
      'flex-start',
    );
  });
});
