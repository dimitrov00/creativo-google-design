import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  EnvironmentProviders,
  Injectable,
  WritableSignal,
  signal,
} from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import {
  Translation,
  TranslocoLoader,
  TranslocoService,
  provideTransloco,
} from '@jsverse/transloco';
import { Observable, of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { AccountStateService } from '@creativo/features/client/account-state';
import { GATEWAY_PORTS } from '@creativo/infrastructure/firebase-app';
import {
  BirthDate,
  BookingContact,
  E164,
  Email,
  type ProfileEdits,
} from '@core/components';
import type { User } from '@core/entities';
import { Callables } from '@core/ports';
import { Result, UserId } from '@core/primitives';
import { PipelineError } from '@core/errors';
import { registeredUserFixture, scriptedGatewayPorts } from '@core/testing';
import { BookingContactSheet } from './booking-contact-sheet';

/** Ада Тестова, registered — her `users/{uid}` body as stored. */
const PROFILE: User = registeredUserFixture({
  id: UserId.of('user_1'),
  phone: E164.of('+359881234567'),
  firstName: 'Ада',
  lastName: 'Тестова',
  email: Email.of('ada@example.com'),
  birthDate: BirthDate.of('1990-05-01'),
});

@Injectable()
class TestTranslationLoader implements TranslocoLoader {
  getTranslation(): Observable<Translation> {
    return of({} as Translation);
  }
}

function provideTestI18n(): EnvironmentProviders[] {
  return provideTransloco({
    config: {
      availableLangs: ['bg', 'en'],
      defaultLang: 'bg',
      fallbackLang: 'bg',
      missingHandler: { logMissingKey: false },
    },
    loader: TestTranslationLoader,
  });
}

/** The phone is the DS composite control's two-way `value`; set it as it does. */
interface SheetInternals {
  phone: WritableSignal<string | null>;
}

interface Harness {
  fixture: ComponentFixture<BookingContactSheet>;
  host: HTMLElement;
  /** Every profile edit the `updateProfile` callable was sent, in order. */
  written: ProfileEdits[];
  emitted: BookingContact.Present[];
  refresh: ReturnType<typeof vi.fn>;
  settle(): Promise<void>;
  typePhone(value: string | null): Promise<void>;
}

async function render(options?: {
  profile?: User | null;
  /** The profile write fails on the server (its store, or the network). */
  writeFails?: boolean;
}): Promise<Harness> {
  const written: ProfileEdits[] = [];
  const emitted: BookingContact.Present[] = [];
  const refresh = vi.fn();
  const profile = options?.profile === undefined ? PROFILE : options.profile;

  await TestBed.configureTestingModule({
    imports: [BookingContactSheet],
    providers: [
      ...provideTestI18n(),
      {
        provide: AccountStateService,
        useValue: { account: signal(profile), refresh },
      },
      {
        // The ONE profile write there is: the `updateProfile` callable.
        provide: GATEWAY_PORTS,
        useValue: scriptedGatewayPorts({
          [Callables.UpdateProfile]: (edits) => {
            if (options?.writeFails) {
              return Result.err(PipelineError.fromWire('internal', null));
            }
            written.push(edits);
            return Result.ok({ changed: true });
          },
        }),
      },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(BookingContactSheet);
  fixture.componentInstance.saved.subscribe((contact) => emitted.push(contact));
  // The phone rules arrive lazily (`phone.lazy.ts`): each pass lets a
  // pending load land before the view is read.
  const settle = async () => {
    for (let pass = 0; pass < 4; pass++) {
      fixture.detectChanges();
      await fixture.whenStable();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  };
  await settle();
  return {
    fixture,
    host: fixture.nativeElement,
    written,
    emitted,
    refresh,
    settle,
    typePhone: async (value) => {
      (fixture.componentInstance as unknown as SheetInternals).phone.set(value);
      await settle();
    },
  };
}

function find(host: HTMLElement, testId: string): HTMLElement | null {
  return host.querySelector<HTMLElement>(`[data-testid="${testId}"]`);
}

async function type(
  harness: Harness,
  testId: string,
  value: string,
): Promise<void> {
  const input = find(harness.host, testId) as HTMLInputElement | null;
  if (!input) throw new Error(`no input ${testId}`);
  input.value = value;
  input.dispatchEvent(new Event('input'));
  await harness.settle();
}

async function click(harness: Harness, testId: string): Promise<void> {
  const target = find(harness.host, testId);
  if (!target) throw new Error(`no control ${testId}`);
  target.click();
  await harness.settle();
}

const SWITCH = 'booking-contact-save-profile';
const FOOTNOTE = 'booking-contact-this-booking-only';

describe('BookingContactSheet — the profile save is the name only (FIX 2)', () => {
  it('offers nothing to save while the sheet says what the profile says', async () => {
    const harness = await render();

    expect(find(harness.host, SWITCH)).toBeNull();
    expect(find(harness.host, FOOTNOTE)).toBeNull();
  });

  it('offers the switch, worded for the name, once the typed name differs', async () => {
    const harness = await render();

    await type(harness, 'booking-contact-name', 'Ада Иванова');

    const toggle = find(harness.host, SWITCH);
    expect(toggle).not.toBeNull();
    expect(toggle?.getAttribute('aria-label')).toBe(
      'booking.contact.saveToProfile',
    );
    // A name change is not a contact change.
    expect(find(harness.host, FOOTNOTE)).toBeNull();
  });

  it('hides the switch again when the name is typed back, spacing aside', async () => {
    const harness = await render();
    await type(harness, 'booking-contact-name', 'Ада Иванова');

    await type(harness, 'booking-contact-name', '  Ада   Тестова ');

    expect(find(harness.host, SWITCH)).toBeNull();
  });

  // A single word keeps the stored surname, so «Ада» over «Ада Тестова»
  // would save exactly what is stored: nothing to offer.
  it('offers nothing for a first name alone that matches the profile’s', async () => {
    const harness = await render();

    await type(harness, 'booking-contact-name', 'Ада');

    expect(find(harness.host, SWITCH)).toBeNull();
  });

  it('offers a new first name alone, and saves it over the stored surname', async () => {
    const harness = await render();
    await type(harness, 'booking-contact-name', 'Адела');
    await click(harness, SWITCH);

    await click(harness, 'booking-contact-save');

    expect(harness.written).toEqual([
      { firstName: 'Адела', lastName: 'Тестова', birthDate: null },
    ]);
  });

  it('counts a change of case as a name to save', async () => {
    const harness = await render();

    await type(harness, 'booking-contact-name', 'ада тестова');

    expect(find(harness.host, SWITCH)).not.toBeNull();
  });

  it('says the phone and e-mail apply to this booking only once either differs', async () => {
    const harness = await render();

    await harness.typePhone('+359887654321');
    expect(find(harness.host, FOOTNOTE)?.textContent?.trim()).toBe(
      'booking.contact.contactThisBookingOnly',
    );
    // The number alone changed: no name to save, so no switch.
    expect(find(harness.host, SWITCH)).toBeNull();

    await harness.typePhone('+359881234567');
    expect(find(harness.host, FOOTNOTE)).toBeNull();

    await type(harness, 'booking-contact-email', 'ada@work.example.com');
    expect(find(harness.host, FOOTNOTE)).not.toBeNull();
  });

  it('reads the profile e-mail typed in another case as the same address', async () => {
    const harness = await render();

    await type(harness, 'booking-contact-email', ' ADA@example.com ');

    expect(find(harness.host, FOOTNOTE)).toBeNull();
  });

  it('sends the profile the typed NAME alone, and books with the typed phone and e-mail', async () => {
    const harness = await render();
    await type(harness, 'booking-contact-name', 'Ада Иванова');
    await harness.typePhone('+359887654321');
    await type(harness, 'booking-contact-email', 'ada@work.example.com');
    await click(harness, SWITCH);

    await click(harness, 'booking-contact-save');

    // Only the names travel: the birth date is kept (`null`), and the phone
    // and e-mail are the account's, never part of the edit.
    expect(harness.written).toEqual([
      { firstName: 'Ада', lastName: 'Иванова', birthDate: null },
    ]);

    expect(harness.emitted).toEqual([
      {
        contactName: 'Ада Иванова',
        contactPhone: '+359887654321',
        contactEmail: 'ada@work.example.com',
        contactNote: null,
      },
    ]);
  });

  it('keeps the visit’s own note on the contact it saves', async () => {
    const harness = await render();
    harness.fixture.componentRef.setInput('uiContact', {
      contactName: 'Ада Тестова',
      contactPhone: E164.of('+359881234567'),
      contactEmail: null,
      contactNote: 'Allergic to lavender',
    } satisfies BookingContact);
    await harness.settle();

    await click(harness, 'booking-contact-save');

    expect(harness.emitted[0]?.contactNote).toBe('Allergic to lavender');
  });

  it('seeds the phone field’s country from the stored number', async () => {
    const harness = await render();

    expect(
      (
        harness.fixture.componentInstance as unknown as {
          phoneCountry(): string | null;
        }
      ).phoneCountry(),
    ).toBe('BG');
  });

  it('refuses a contact the domain refuses, in its own words — and saves nothing', async () => {
    const harness = await render();
    await type(harness, 'booking-contact-email', 'not-an-email');

    await click(harness, 'booking-contact-save');

    expect(harness.emitted).toEqual([]);
    expect(
      find(harness.host, 'booking-contact-error')?.textContent?.trim(),
    ).toBe('SCHEDULING_BOOKING_CONTACT_INVALID_EMAIL');
  });

  it('leaves the refresh to the live profile listener', async () => {
    const harness = await render();
    await type(harness, 'booking-contact-name', 'Ада Иванова');
    await click(harness, SWITCH);

    await click(harness, 'booking-contact-save');

    expect(harness.written).toHaveLength(1);
    expect(harness.refresh).not.toHaveBeenCalled();
  });

  it('writes nothing to the profile while the switch is off', async () => {
    const harness = await render();
    await type(harness, 'booking-contact-name', 'Ада Иванова');

    await click(harness, 'booking-contact-save');

    expect(harness.written).toEqual([]);
    expect(harness.emitted).toHaveLength(1);
  });

  it('never writes through a switch the name typed back has hidden', async () => {
    const harness = await render();
    await type(harness, 'booking-contact-name', 'Ада Иванова');
    await click(harness, SWITCH);
    await type(harness, 'booking-contact-name', 'Ада Тестова');

    await click(harness, 'booking-contact-save');

    expect(harness.written).toEqual([]);
    expect(harness.emitted).toHaveLength(1);
  });

  it('stays put and says so when the profile write fails', async () => {
    const harness = await render({ writeFails: true });
    await type(harness, 'booking-contact-name', 'Ада Иванова');
    await click(harness, SWITCH);

    await click(harness, 'booking-contact-save');

    expect(harness.emitted).toEqual([]);
    expect(
      find(harness.host, 'booking-contact-error')?.textContent?.trim(),
    ).toBe('booking.contact.profileFailed');
  });

  /*
   * DEP-23 (pass D): the sheet holds the refusal's struct and words it in a
   * `computed`, so a line shown in bg re-words when the language switches
   * to en — before, the words were fixed when the line was set and the bg
   * line stayed until the next save. In the language it was raised in the
   * line is byte-identical (the same `errors.<errorCode>` line with the
   * struct's params; the profile write's `booking.contact.profileFailed`).
   */
  describe('DEP-23 — a shown line re-words on a language switch', () => {
    type Lang = 'bg' | 'en';

    /** The app's own catalogue for `lang` — read, never re-typed. */
    function catalogue(lang: Lang): {
      readonly errors: Record<string, string>;
      readonly booking: { readonly contact: Record<string, string> };
    } {
      return JSON.parse(
        // eslint-disable-next-line security/detect-non-literal-fs-filename -- a fixed path to the app's own catalogue.
        readFileSync(
          resolve(
            __dirname,
            `../../../../../../infrastructure/i18n/src/assets/i18n/${lang}.json`,
          ),
          'utf8',
        ),
      );
    }

    /** Loads the two languages' shipped lines this case reads; bg stays active. */
    function loadLines(): void {
      const transloco = TestBed.inject(TranslocoService);
      for (const lang of ['bg', 'en'] as const) {
        const shipped = catalogue(lang);
        transloco.setTranslation(
          {
            errors: {
              SCHEDULING_BOOKING_CONTACT_INVALID_EMAIL:
                shipped.errors['SCHEDULING_BOOKING_CONTACT_INVALID_EMAIL'],
            },
            booking: {
              contact: {
                profileFailed: shipped.booking.contact['profileFailed'],
              },
            },
          },
          lang,
        );
      }
      transloco.setActiveLang('bg');
    }

    const lineOf = (harness: Harness) =>
      find(harness.host, 'booking-contact-error')?.textContent?.trim();

    it('a refused contact shown in bg prints its en line once the language switches', async () => {
      const harness = await render();
      loadLines();
      await type(harness, 'booking-contact-email', 'not-an-email');

      await click(harness, 'booking-contact-save');

      expect(lineOf(harness)).toBe(
        catalogue('bg').errors[
          'SCHEDULING_BOOKING_CONTACT_INVALID_EMAIL'
        ]?.replace('{{rawValue}}', 'not-an-email'),
      );

      TestBed.inject(TranslocoService).setActiveLang('en');
      await harness.settle();

      expect(lineOf(harness)).toBe(
        catalogue('en').errors[
          'SCHEDULING_BOOKING_CONTACT_INVALID_EMAIL'
        ]?.replace('{{rawValue}}', 'not-an-email'),
      );
      expect(harness.emitted).toEqual([]);
    });

    it('a failed profile write shown in bg prints its en line once the language switches', async () => {
      const harness = await render({ writeFails: true });
      loadLines();
      await type(harness, 'booking-contact-name', 'Ада Иванова');
      await click(harness, SWITCH);

      await click(harness, 'booking-contact-save');

      expect(lineOf(harness)).toBe(
        catalogue('bg').booking.contact['profileFailed'],
      );

      TestBed.inject(TranslocoService).setActiveLang('en');
      await harness.settle();

      expect(lineOf(harness)).toBe(
        catalogue('en').booking.contact['profileFailed'],
      );
      expect(harness.emitted).toEqual([]);
    });
  });

  it('offers neither the switch nor the footnote without a profile', async () => {
    const harness = await render({ profile: null });
    await type(harness, 'booking-contact-name', 'Гост Гостов');
    await harness.typePhone('+359887654321');

    expect(find(harness.host, SWITCH)).toBeNull();
    expect(find(harness.host, FOOTNOTE)).toBeNull();

    await click(harness, 'booking-contact-save');
    expect(harness.written).toEqual([]);
    expect(harness.emitted).toHaveLength(1);
  });
});
