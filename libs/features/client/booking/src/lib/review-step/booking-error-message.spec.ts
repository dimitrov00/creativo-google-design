import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { TranslocoService } from '@jsverse/transloco';
import { describe, expect, it } from 'vitest';
import {
  BookingGatewayError,
  shopReachKey,
} from '@creativo/application/booking';
import {
  bookingErrorMessage,
  callHrefForRefusal,
  carriedRefusalOf,
} from './booking-error-message';

interface Catalogue {
  readonly errors: Readonly<Record<string, string>>;
  readonly booking: {
    readonly moveRefused: Readonly<
      Record<string, { readonly body?: string } | string>
    >;
  };
  readonly appointments: {
    readonly cancel: Readonly<Record<string, string>>;
    readonly visit: Readonly<Record<string, string>>;
  };
}

/**
 * The SHIPPED catalogues, read from disk rather than imported — they belong
 * to the i18n project, and a spec asserting the copy the client will see
 * must read the real thing, not a paraphrase of it.
 */
function catalogue(lang: 'bg' | 'en'): Catalogue {
  // The workspace root is wherever `nx.json` is, whichever directory the
  // runner starts in.
  let root = process.cwd();
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- test-only walk up from the runner's cwd to the workspace root; every segment is a constant.
  while (!existsSync(join(root, 'nx.json')) && dirname(root) !== root) {
    root = dirname(root);
  }
  const path = join(
    root,
    'libs/infrastructure/i18n/src/assets/i18n',
    `${lang}.json`,
  );
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- test-only read of a shipped catalogue; `lang` is the closed union above.
  return JSON.parse(readFileSync(path, 'utf8')) as Catalogue;
}

const en = catalogue('en');
const bg = catalogue('bg');

/**
 * Transloco's lookup over one real catalogue: `errors` holds flat dotted keys
 * (`"booking.gateway.failed"`) beside nested groups, so a key resolves to
 * `errors` + the rest, verbatim — and a missing key comes back as itself,
 * which is what the real service answers too.
 */
function translator(source: Catalogue): TranslocoService {
  const errors = new Map<string, unknown>(Object.entries(source.errors));
  /** Any other key walks the nested groups (`booking.reach.call`). */
  const nested = (key: string): unknown =>
    key
      .split('.')
      .reduce<unknown>(
        (node, part) =>
          node !== null && typeof node === 'object'
            ? new Map(Object.entries(node)).get(part)
            : undefined,
        source,
      );
  return {
    translate: (key: string, params: Record<string, unknown> = {}) => {
      const found = key.startsWith('errors.')
        ? errors.get(key.replace(/^errors\./, ''))
        : nested(key);
      if (typeof found !== 'string') return key;
      return found.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, name: string) =>
        String(new Map(Object.entries(params)).get(name) ?? ''),
      );
    },
  } as unknown as TranslocoService;
}

/** The shop's number, as the page dials it when the catalogue knows it. */
const CALL = 'tel:+359888123456';

/** The phrase a sentence sends the client to the shop with — see `shopReachKey`. */
function reach(catalogue: Catalogue, kind: 'call' | 'contact'): string {
  const phrase = translator(catalogue).translate(`booking.reach.${kind}`);
  expect(phrase).not.toBe(`booking.reach.${kind}`);
  return phrase;
}

const CARRIED = 'booking.reschedule.carried_seat_unplaceable';

/** One `errors` entry of a shipped catalogue, by its flat dotted key. */
function copy(catalogue: Catalogue, key: string): string | undefined {
  return new Map(Object.entries(catalogue.errors)).get(key);
}

function carried(refusal: string): BookingGatewayError {
  return new BookingGatewayError('unknown', 'refused', {
    serverCode: CARRIED,
    refusal,
    seatIds: 'seat-son',
  });
}

describe('bookingErrorMessage — what the review step says about a refusal', () => {
  // Every reason the server names has its OWN sentence, in both languages —
  // one sentence for all of them told a client whose companion's service was
  // retired that "someone can't come at that time".
  const REFUSALS = [
    'barber_unavailable',
    'service_unavailable',
    'outside_booking_window',
    'party_conflict',
    'shop_only',
  ] as const;

  for (const refusal of REFUSALS) {
    it(`gives a carried seat refused as ${refusal} its own words, in bg and en`, () => {
      for (const catalogue of [en, bg]) {
        const own = copy(catalogue, `${CARRIED}.${refusal}`);
        expect(own).toBeTruthy();
        expect(
          bookingErrorMessage(translator(catalogue), carried(refusal), CALL),
        ).toBe(own?.replace('{{reach}}', reach(catalogue, 'call')));
        expect(own).not.toBe(copy(catalogue, CARRIED));
      }
    });
  }

  it('offers ANOTHER TIME first where another time can fix it, and a call after', () => {
    for (const refusal of [
      'barber_unavailable',
      'outside_booking_window',
      'party_conflict',
    ]) {
      const english = bookingErrorMessage(
        translator(en),
        carried(refusal),
        CALL,
      );
      expect(english.indexOf('another time')).toBeGreaterThan(-1);
      expect(english.indexOf('another time')).toBeLessThan(
        english.indexOf('call'),
      );
      const bulgarian = bookingErrorMessage(
        translator(bg),
        carried(refusal),
        CALL,
      );
      expect(bulgarian.indexOf('Избери друг час')).toBeGreaterThan(-1);
      expect(bulgarian.indexOf('Избери друг час')).toBeLessThan(
        bulgarian.indexOf('обади'),
      );
    }
  });

  it('sends the client to the phone — and never to another time — where only the shop can fix it', () => {
    for (const refusal of ['service_unavailable', 'shop_only']) {
      const english = bookingErrorMessage(
        translator(en),
        carried(refusal),
        CALL,
      );
      expect(english).toMatch(/call/i);
      expect(english).not.toContain('another time');
      const bulgarian = bookingErrorMessage(
        translator(bg),
        carried(refusal),
        CALL,
      );
      expect(bulgarian).toMatch(/обади/i);
      expect(bulgarian).not.toContain('друг час');
    }
  });

  it('never promises a call when the page has no number to dial — it says to get in touch instead', () => {
    for (const refusal of [...REFUSALS, 'something_new']) {
      const english = bookingErrorMessage(translator(en), carried(refusal));
      expect(english).not.toMatch(/call/i);
      expect(english).toContain(reach(en, 'contact'));
      const bulgarian = bookingErrorMessage(translator(bg), carried(refusal));
      expect(bulgarian).not.toMatch(/обади/i);
      expect(bulgarian).toContain(reach(bg, 'contact'));
    }
  });

  it('falls back to the code’s own copy for a reason the catalogue does not know yet', () => {
    for (const catalogue of [en, bg]) {
      expect(
        bookingErrorMessage(
          translator(catalogue),
          carried('something_new'),
          CALL,
        ),
      ).toBe(
        copy(catalogue, CARRIED)?.replace(
          '{{reach}}',
          reach(catalogue, 'call'),
        ),
      );
    }
  });

  it('reads the FIELD an invalid request names as its reason — one person in two chairs, two guests under one name', () => {
    for (const field of ['person_overlap', 'guest_label']) {
      const error = new BookingGatewayError('invalid_request', 'refused', {
        serverCode: 'booking.commit.invalid_input',
        field,
      });
      for (const catalogue of [en, bg]) {
        const own = copy(catalogue, `booking.commit.invalid_input.${field}`);
        expect(own).toBeTruthy();
        expect(bookingErrorMessage(translator(catalogue), error)).toBe(own);
        expect(own).not.toBe(copy(catalogue, 'booking.commit.invalid_input'));
      }
    }
    // A field the catalogue has no words for is the code's own copy.
    const unknown = new BookingGatewayError('invalid_request', 'refused', {
      serverCode: 'booking.commit.invalid_input',
      field: 'seats',
    });
    expect(bookingErrorMessage(translator(en), unknown)).toBe(
      copy(en, 'booking.commit.invalid_input'),
    );
  });

  it('speaks the server’s specific copy with its parameters', () => {
    const error = new BookingGatewayError('invalid_request', 'too soon', {
      serverCode: 'booking.commit.too_soon',
      minLeadMinutes: '120',
    });
    expect(bookingErrorMessage(translator(en), error)).toContain('120');
  });

  it('falls back to the gateway’s own copy for a code the catalogue does not know — never a raw code', () => {
    const error = new BookingGatewayError('unknown', 'boom', {
      serverCode: 'booking.something.new',
    });
    expect(bookingErrorMessage(translator(en), error)).toBe(
      en.errors['booking.gateway.failed'],
    );
  });

  it('uses the gateway’s own copy when the server sent no code at all', () => {
    const error = new BookingGatewayError('unavailable', 'offline');
    expect(bookingErrorMessage(translator(en), error)).toBe(
      en.errors['booking.gateway.failed'],
    );
  });
});

describe('carriedRefusalOf — when the review step offers the shop’s number', () => {
  it('names the reason of a carried-seat refusal', () => {
    expect(carriedRefusalOf(carried('service_unavailable'))).toBe(
      'service_unavailable',
    );
  });

  it('is null for every other failure — a taken slot is fixed by the grid, not a call', () => {
    expect(
      carriedRefusalOf(
        new BookingGatewayError('slot_unavailable', 'gone', {
          serverCode: 'booking.commit.slot_unavailable',
        }),
      ),
    ).toBeNull();
    expect(
      carriedRefusalOf(new BookingGatewayError('unavailable', 'offline')),
    ).toBeNull();
    // A `refusal` riding on some other code is not this one.
    expect(
      carriedRefusalOf(
        new BookingGatewayError('unknown', 'x', {
          serverCode: 'booking.commit.invalid_input',
          refusal: 'barber_unavailable',
        }),
      ),
    ).toBeNull();
  });
});

describe('callHrefForRefusal — the review step’s call button', () => {
  const PHONE = '+359888123456';

  it('dials the shop beside every refusal of a carried companion', () => {
    for (const refusal of [
      'barber_unavailable',
      'service_unavailable',
      'outside_booking_window',
      'party_conflict',
      'shop_only',
    ]) {
      expect(callHrefForRefusal(carried(refusal), PHONE)).toBe(`tel:${PHONE}`);
    }
  });

  it('offers no call for anything else, for no error, or with no number to dial', () => {
    expect(
      callHrefForRefusal(
        new BookingGatewayError('slot_unavailable', 'gone', {
          serverCode: 'booking.commit.slot_unavailable',
        }),
        PHONE,
      ),
    ).toBeNull();
    expect(callHrefForRefusal(null, PHONE)).toBeNull();
    expect(callHrefForRefusal(carried('shop_only'), null)).toBeNull();
  });
});

describe('the move-refused panel promises only what it can do', () => {
  it('never tells the client to call when it could not read the visit — the page has no shop to dial then', () => {
    for (const catalogue of [en, bg]) {
      const unavailable = catalogue.booking.moveRefused['unavailable'];
      const body = typeof unavailable === 'string' ? '' : unavailable?.body;
      expect(body).toBeTruthy();
      expect(body).not.toMatch(/call|обади/i);
    }
  });

  it('sends the client to the shop ONLY through `{{reach}}` — so "call" appears exactly when the call button does', () => {
    // Every sentence that ends at the shop: the move-refused panel, review's
    // carried-seat refusals, and the appointments page (a closed free-cancel
    // window, from the page and from the server; a visit only the shop moves).
    const sentences = (catalogue: Catalogue): readonly string[] => [
      ...['companions_only', 'carried_out_of_reach'].map((reason) => {
        const entry = new Map(
          Object.entries(catalogue.booking.moveRefused),
        ).get(reason);
        return typeof entry === 'string' ? '' : (entry?.body ?? '');
      }),
      ...Object.entries(catalogue.errors)
        .filter(
          ([key]) =>
            key.startsWith(CARRIED) || key === 'booking.cancel.window_closed',
        )
        .map(([, sentence]) => sentence),
      catalogue.appointments.cancel['windowClosed'] ?? '',
      catalogue.appointments.visit['shopMoves'] ?? '',
    ];
    for (const catalogue of [en, bg]) {
      const all = sentences(catalogue);
      expect(all.length).toBeGreaterThanOrEqual(11);
      for (const sentence of all) {
        expect(sentence).toContain('{{reach}}');
        expect(sentence.replace('{{reach}}', '')).not.toMatch(/call|обади/i);
      }
      // …and the two phrases it is filled with say what they promise.
      expect(reach(catalogue, 'call')).toMatch(/call|обади/i);
      expect(reach(catalogue, 'contact')).not.toMatch(/call|обади/i);
    }
  });

  it('picks the phrase from the call the page offers — `shopReachKey`', () => {
    for (const catalogue of [en, bg]) {
      const phrase = (href: string | null) =>
        translator(catalogue).translate(shopReachKey(href));
      expect(phrase('tel:+359888123456')).toBe(reach(catalogue, 'call'));
      expect(phrase(null)).toBe(reach(catalogue, 'contact'));
    }
  });

  it('keeps no second, call-only sentence beside a parametrized one', () => {
    for (const catalogue of [en, bg]) {
      expect(catalogue.appointments.visit['shopMovesCall']).toBeUndefined();
    }
  });
});
