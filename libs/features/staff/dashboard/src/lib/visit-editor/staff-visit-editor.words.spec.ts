import { Injectable, type Signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  type Translation,
  type TranslocoLoader,
  TranslocoService,
  provideTransloco,
} from '@jsverse/transloco';
import { type Observable, ReplaySubject, firstValueFrom } from 'rxjs';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  AppointmentId,
  Currency,
  LocalDate,
  PriceCents,
  TrackMinute,
  UtcEpochMs,
} from '@core/primitives';
import { memoryClockPorts, unwrapOk } from '@core/testing';
import { CLOCK_PORTS } from '@creativo/infrastructure/firebase-app';
import { StaffVisitEditor, type VisitEditorVm } from './staff-visit-editor';
import type { VisitEditorWords } from './visit-editor.vm';

/*
 * VE-11: THE WORDS FOLLOW THE TABLE, AND NOTHING LOOPS. A shipped build froze
 * the tab with `translate()` inside a tracked `computed()`; `rawCopy` then read
 * the table with no signal at all, so a `computed` worded before the load kept
 * the key until something else moved it. `words` tracks the loaded table and
 * nothing else, so these are the two things it must do.
 */

/** A catalogue that lands when the spec says so. */
const TABLES = new Map<string, ReplaySubject<Translation>>();

@Injectable()
class HeldLoader implements TranslocoLoader {
  getTranslation(lang: string): Observable<Translation> {
    const known = TABLES.get(lang);
    if (known !== undefined) return known;
    const table = new ReplaySubject<Translation>(1);
    TABLES.set(lang, table);
    return table;
  }
}

const BG: Translation = {
  'staff.visit.newTitle': 'Нов час',
  'staff.visit.minutes': '{{minutes}} мин',
};
const EN: Translation = {
  'staff.visit.newTitle': 'New appointment',
  'staff.visit.minutes': '{{minutes}} min',
};

const vm = (appointmentId: AppointmentId | null): VisitEditorVm => ({
  appointmentId,
  rowId: 'row',
  peers: [],
  dayKey: unwrapOk(LocalDate.parse('2026-08-26')),
  dayLabel: 'ср, 26.08',
  startMinute: TrackMinute.ofProven(600),
  endMinute: TrackMinute.ofProven(630),
  legs: [],
  clientLabel: '',
  clientUserId: null,
  clientCustomerId: null,
  phone: null,
  phoneHref: null,
  clientMeta: null,
  note: null,
  teamNote: null,
  priceLabel: null,
  priceCents: PriceCents.ZERO,
  currency: Currency.EUR,
  tipLabel: null,
  tipCents: null,
  discounts: [],
  vouchers: [],
  resolution: null,
  bookingStatus: null,
  statusLabel: '',
  arrivedMinute: null,
  locationId: null,
  timeZone: null,
  chairId: null,
  chairName: 'Иван',
  chairTone: 0,
  neighbours: [],
  rosterStartMinute: TrackMinute.ofProven(540),
  rosterEndMinute: TrackMinute.ofProven(1080),
  now: null,
  primaryVerb: null,
  overflowVerbs: [],
  acting: false,
});

/** The struct a presenter takes, off the component. */
const wordsOf = (editor: StaffVisitEditor) =>
  (editor as unknown as { words: Signal<VisitEditorWords> }).words;

describe('the sheet’s words', () => {
  beforeEach(() => {
    TABLES.clear();
    TestBed.configureTestingModule({
      imports: [StaffVisitEditor],
      providers: [
        ...provideTransloco({
          config: {
            availableLangs: ['bg', 'en'],
            defaultLang: 'bg',
            missingHandler: { logMissingKey: false },
          },
          loader: HeldLoader,
        }),
        {
          provide: CLOCK_PORTS,
          useValue: memoryClockPorts(UtcEpochMs.EPOCH),
        },
      ],
    });
  });

  function open() {
    const fixture = TestBed.createComponent(StaffVisitEditor);
    fixture.componentRef.setInput('vm', vm(null));
    return fixture;
  }

  it('reads a key while the table is away, and the word the moment it lands', () => {
    const fixture = open();
    const editor = fixture.componentInstance;
    // The bar's title is bound by the shell before the sheet has rendered.
    expect(editor.sheetTitle()).toBe('staff.visit.newTitle');
    TABLES.get('bg')?.next(BG);
    expect(editor.sheetTitle()).toBe('Нов час');
    expect(wordsOf(editor)().minutes(30)).toBe('30 мин');
  });

  it('re-words on a change of language', async () => {
    const fixture = open();
    const editor = fixture.componentInstance;
    TABLES.get('bg')?.next(BG);
    expect(editor.sheetTitle()).toBe('Нов час');
    const transloco = TestBed.inject(TranslocoService);
    transloco.setActiveLang('en');
    TABLES.get('en')?.next(EN);
    await firstValueFrom(transloco.selectTranslation('en'));
    expect(editor.sheetTitle()).toBe('New appointment');
    expect(wordsOf(editor)().minutes(30)).toBe('30 min');
  });

  it('settles: one struct per table, whatever else moves', () => {
    const fixture = open();
    const editor = fixture.componentInstance;
    TABLES.get('bg')?.next(BG);
    const words = wordsOf(editor)();
    fixture.detectChanges();
    fixture.componentRef.setInput('vm', vm(AppointmentId.of('appointment-1')));
    fixture.detectChanges();
    expect(editor.sheetTitle()).toBe('staff.visit.walkIn');
    expect(wordsOf(editor)()).toBe(words);
  });
});
