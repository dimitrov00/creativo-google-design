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
  provideTransloco,
} from '@jsverse/transloco';
import { Observable, of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { ZonedDateTime } from '@creativo/application/accounts';
import {
  type BookingContactProps,
  type Result,
  ok,
} from '@creativo/application/booking';
import { CLOCK } from '@creativo/application/shared';
import { AccountStateService } from '@creativo/features/client/account-state';
import { PROFILE_PORTS } from '@creativo/infrastructure/firebase-app';
import { BirthDate, E164, Email } from '@core/components';
import type { User } from '@core/entities';
import type { ProfilePorts } from '@core/ports';
import { RepositoryError, Result as EcsResult, UserId } from '@core/primitives';
import { memoryProfilePorts, registeredUserFixture } from '@core/testing';
import { BookingContactSheet } from './booking-contact-sheet';

function unwrap<T>(result: Result<T, unknown>): T {
  if (result.isFailure()) throw new Error('fixture failed');
  return result.value;
}

const TODAY = unwrap(ZonedDateTime.fromISO('2026-01-01T00:00:00.000Z', 'UTC'));

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
  written: User[];
  emitted: BookingContactProps[];
  refresh: ReturnType<typeof vi.fn>;
  settle(): Promise<void>;
  typePhone(value: string | null): Promise<void>;
}

async function render(options?: {
  profile?: User | null;
  /** The owner write fails in the store (a rule denial), writing nothing. */
  writeFails?: boolean;
}): Promise<Harness> {
  const written: User[] = [];
  const emitted: BookingContactProps[] = [];
  const refresh = vi.fn();
  const profile = options?.profile === undefined ? PROFILE : options.profile;
  const users = new Map<UserId, User>();
  if (profile !== null) users.set(profile.id, profile);
  const memory = memoryProfilePorts(users);

  await TestBed.configureTestingModule({
    imports: [BookingContactSheet],
    providers: [
      ...provideTestI18n(),
      {
        provide: AccountStateService,
        useValue: { account: signal(profile), refresh },
      },
      {
        provide: PROFILE_PORTS,
        useValue: {
          ...memory,
          writeOwnProfile: async (userId, decide) => {
            if (options?.writeFails) {
              return EcsResult.err(
                RepositoryError.writeFailed(`users/${userId}`, 'denied'),
              );
            }
            const before = users.get(userId);
            const result = await memory.writeOwnProfile(userId, decide);
            const after = users.get(userId);
            if (after !== undefined && after !== before) written.push(after);
            return result;
          },
        } satisfies ProfilePorts,
      },
      { provide: CLOCK, useValue: { now: () => ok(TODAY) } },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(BookingContactSheet);
  fixture.componentInstance.saved.subscribe((contact) => emitted.push(contact));
  const settle = async () => {
    for (let pass = 0; pass < 4; pass++) {
      fixture.detectChanges();
      await fixture.whenStable();
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

    expect(harness.written).toHaveLength(1);
    expect(harness.written[0]?.firstName).toBe('Адела');
    expect(harness.written[0]?.lastName).toBe('Тестова');
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

  it('writes the typed name with the STORED phone and e-mail, and books with the typed ones', async () => {
    const harness = await render();
    await type(harness, 'booking-contact-name', 'Ада Иванова');
    await harness.typePhone('+359887654321');
    await type(harness, 'booking-contact-email', 'ada@work.example.com');
    await click(harness, SWITCH);

    await click(harness, 'booking-contact-save');

    expect(harness.written).toHaveLength(1);
    const [written] = harness.written;
    expect(written?.firstName).toBe('Ада');
    expect(written?.lastName).toBe('Иванова');
    expect(written?.phone).toBe('+359881234567');
    expect(written?.email).toBe('ada@example.com');
    expect(written?.birthDate).toBe('1990-05-01');
    // The search keys index the STORED contact, the new names.
    expect(written?.searchName).toBe('ада иванова');

    expect(harness.emitted).toEqual([
      {
        name: 'Ада Иванова',
        phone: '+359887654321',
        email: 'ada@work.example.com',
        note: null,
      },
    ]);
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
