import { DraftPersonKey } from '@core/primitives';
import type { CountryIso2 } from '@core/components';
import {
  ClientQuerySystem,
  PhoneSystem,
  VisitDraftSystem,
  type ParsedClientQuery,
} from '@core/systems';

/** «Нов клиент» as typed: every field may stay empty. */
export type NewClientForm = {
  readonly name: string;
  readonly phone: string | null;
  readonly email: string;
};

export const EMPTY_NEW_CLIENT: NewClientForm = {
  name: '',
  phone: null,
  email: '',
};

/**
 * EVERY PART, where it belongs (2026-09-18): «Мария 088 765 4321
 * maria@mail.bg» opens the form with all three fields filled. The number
 * reaches the phone field as E.164 by the shop's own dial code — the field
 * validates for real — and too few digits are not a number on its way
 * anywhere (`ClientQuerySystem.prefillsPhone`).
 */
export function prefilledNewClient(
  parsed: ParsedClientQuery,
  country: CountryIso2,
): NewClientForm {
  const [international] = PhoneSystem.searchDigitsOf(
    parsed.phoneTyped,
    PhoneSystem.callingCodeOr(country, ClientQuerySystem.DEFAULT_CALLING_CODE),
  ).phoneReadingCandidates;
  return {
    name: parsed.name,
    phone:
      international !== undefined && ClientQuerySystem.prefillsPhone(parsed)
        ? `+${international}`
        : null,
    email: parsed.email,
  };
}

/**
 * The name a person seated WITHOUT one rides under — «Случаен клиент»,
 * numbered past the visit's own people as the save numbers its strangers
 * (`VisitDraftSystem.walkInLabels`).
 */
export function walkInFallbackOf(
  labels: readonly string[],
  words: {
    readonly walkIn: string;
    readonly walkInNumbered: (number: number) => string;
  },
): string {
  const [walkIn] = VisitDraftSystem.walkInLabels(
    [DraftPersonKey.PLACEHOLDER],
    labels,
    (number) => (number === null ? words.walkIn : words.walkInNumbered(number)),
  );
  return walkIn?.label ?? words.walkIn;
}
