import { describe, expectTypeOf, it } from 'vitest';
import type {
  VisitFilter,
  VisitLookup,
  VisitRowNameParts,
  VisitRowVm,
  VisitTrailing,
  VisitTrailingFact,
  VisitWaitlistWords,
  VisitWords,
} from './visit-row.vm';

/*
 * The row's view model is types only: these cases are checked by the
 * compiler (`nx typecheck`), and they pin the shapes the other packages
 * build against (§7.3), so a change that would break a host breaks here
 * first.
 */

describe('visit row view model', () => {
  it('keeps the five filter ids the client page names its test ids after', () => {
    // `appointments-filter-{option}` survives the move (§5.3.5).
    expectTypeOf<VisitFilter>().toEqualTypeOf<
      'all' | 'upcoming' | 'completed' | 'no_show' | 'cancelled'
    >();
  });

  it('ends every row in the barber’s face, or in nothing', () => {
    // Revision 3 §3.11 (W4): the trailing edge is the face in BOTH
    // perspectives — the one union the two screens share.
    expectTypeOf<
      NonNullable<VisitTrailing>['kind']
    >().toEqualTypeOf<'barber'>();
    expectTypeOf<NonNullable<VisitTrailing>>().toHaveProperty('several');
    expectTypeOf<null>().toExtend<VisitTrailing>();
  });

  it('ends a staff row with at most one fact, and never with the barber', () => {
    // Revision 3 §3.11: the face keeps the trailing edge in both
    // perspectives; money, a state in words and «Този час» end the second
    // line, and none of them is ever the edge.
    expectTypeOf<NonNullable<VisitTrailingFact>['kind']>().toEqualTypeOf<
      'amount' | 'status' | 'badge'
    >();
    expectTypeOf<null>().toExtend<VisitTrailingFact>();
    expectTypeOf<
      NonNullable<VisitTrailing>
    >().not.toExtend<VisitTrailingFact>();
    expectTypeOf<
      NonNullable<VisitTrailingFact>
    >().not.toExtend<VisitTrailing>();
  });

  it('requires the staff’s fact on every row: a value, or null where there is none', () => {
    // W4 (§7.1 Z2): what W0 added as optional is now part of the row.
    expectTypeOf<
      VisitRowVm['trailingFact']
    >().toEqualTypeOf<VisitTrailingFact>();
    expectTypeOf<Omit<VisitRowVm, 'trailingFact'>>().not.toExtend<VisitRowVm>();
    const amount = {
      kind: 'amount',
      text: '27,50 €',
      emphasis: 'primary',
      struck: false,
    } as const satisfies VisitTrailingFact;
    expectTypeOf(amount).toExtend<VisitRowVm['trailingFact']>();
  });

  it('hands the sentence slots straight to Transloco params', () => {
    // Transloco's `HashMap` is `Record<string, any>`: an interface would
    // need a cast at every host; the alias does not.
    expectTypeOf<VisitRowNameParts>().toExtend<Record<string, string>>();
  });

  it('takes the words as values, so a host fills them from the catalogue once', () => {
    expectTypeOf<VisitWords['cancelledBy']>()
      .parameter(0)
      .toEqualTypeOf<'client' | 'shop'>();
    expectTypeOf<VisitWords['rowName']>().returns.toEqualTypeOf<string>();
    expectTypeOf<VisitWaitlistWords['daypart']>()
      .parameter(0)
      .toEqualTypeOf<'morning' | 'afternoon' | 'evening'>();
  });

  it('adds the confirmed status word without asking a host for it yet', () => {
    // Additive first (§7.0): the words `visitWordsOf` builds today are
    // still the row's words.
    expectTypeOf<VisitWords['statusConfirmed']>().toEqualTypeOf<
      string | undefined
    >();
    expectTypeOf<Omit<VisitWords, 'statusConfirmed'>>().toExtend<VisitWords>();
  });

  it('accepts any object that looks a catalogue up by id', () => {
    const lookup = {
      serviceName: (id: string) => (id === 's1' ? 'Фейд' : null),
      barberName: (id: string) => (id === 'b1' ? 'Иван' : null),
      barberAvatarSrc: () => null,
      locationName: () => 'Център',
      locationCount: 1,
    };
    expectTypeOf(lookup).toExtend<VisitLookup>();
  });

  it('draws a waitlist row with a glyph in place of the tile', () => {
    const waiting = {
      id: 'waitlist-1',
      kind: 'waitlist',
      startMs: Date.UTC(2026, 9, 1, 12),
      sectionKey: 'upcoming',
      upcoming: true,
      tile: null,
      leadingIcon: 'calendar.watching',
      title: 'Фейд',
      struck: false,
      lines: [{ text: 'Чака свободен час' }, { text: 'чт – пт, следобед' }],
      quote: null,
      trailing: null,
      trailingFact: null,
      marks: [],
      outcome: null,
      status: null,
      accessibleName: 'Фейд, чака свободен час: четвъртък и петък, следобед',
      testId: 'client-visit-waitlist',
    } as const satisfies VisitRowVm;
    expectTypeOf(waiting).toExtend<VisitRowVm>();
  });

  it('carries no thumbs: a row is a row, and the card’s photos are `VisitCardVm`’s', () => {
    // W4 (§7.1 Z2): the featured card is `lib-visit-card` (§3.10).
    expectTypeOf<VisitRowVm>().not.toHaveProperty('photos');
  });
});
