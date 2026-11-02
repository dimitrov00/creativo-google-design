import { ClientQueryShape } from '@core/components';
import type { DraftPersonKey } from '@core/primitives';
import {
  ClientQuerySystem,
  type ParsedClientQuery,
  PhoneSystem,
  type TextSegment,
} from '@core/systems';
import type {
  StaffEventLine,
  StaffEventRun,
} from '@creativo/features/shared/visits';
import type { UiIconName } from '@creativo/ui/controls';
import { clientQueryShapeWords } from '../tag-words';
import type { VisitEditorClientOption } from './staff-visit-editor';
import type {
  ClientRowVm,
  CreatePart,
  VisitEditorWords,
} from './visit-editor.vm';

/*
 * THE ADD-CLIENT PAGE'S ROWS (Law 10). What a typed query reads as, and how
 * well a person matches it, is `ClientQuerySystem`'s; which people are listed
 * is the sheet's. This words one person, or one reading of what was typed.
 */

/** Runs only when one of them is the typed one; otherwise the plain text. */
function markedRuns(
  runs: readonly TextSegment[],
): readonly StaffEventRun[] | undefined {
  return runs.some((run) => run.hit) ? runs : undefined;
}

/** What a person row is worded from, beside the person. */
export type ClientRowInput = {
  readonly parsed: ParsedClientQuery;
  /** Who is on the visit already. */
  readonly chosen: ReadonlySet<DraftPersonKey>;
  /** The rank's answer: the typed number or mail is theirs. */
  readonly exact: boolean;
  /** Who may not leave the visit (`VisitDraftSystem.pinnedPerson`), or nobody. */
  readonly pinned: DraftPersonKey | null;
  /** The shop's dial code, which a typed «088…» is read in. */
  readonly callingCode: string;
  readonly words: VisitEditorWords;
};

/**
 * A PERSON ROW IS THE EVENT'S HEAD (owner, 2026-09-22: "there should be
 * phone and email fields dedicated to themselves, not all the data
 * separated by a dot — this looks cheap"): the name, then every fact on
 * its own glyph-led line in the agenda card's order — the mail, the
 * number, when they were last here — the same recipe the card and the
 * frame's block already draw, so a person reads the same on every staff
 * surface. The typed run stays marked in the name and in the lines.
 */
export function clientRowVm(
  client: VisitEditorClientOption,
  input: ClientRowInput,
): ClientRowVm {
  const { parsed, chosen, exact, callingCode, words } = input;
  const lines: StaffEventLine[] = [];
  if (client.email) {
    lines.push({
      text: client.email,
      icon: 'contact.email',
      parts: markedRuns(ClientQuerySystem.emailSegments(client.email, parsed)),
    });
  }
  if (client.phone) {
    lines.push({
      text: client.phone,
      icon: 'contact.phone',
      parts: markedRuns(
        ClientQuerySystem.phoneSegments(client.phone, parsed, callingCode),
      ),
    });
  }
  // `meta` is the owner's own line — «посл. 22.09» — unless it only
  // repeats the mail (the index's hits carry it in both).
  if (client.meta && client.meta !== client.email) {
    lines.push({ text: client.meta, icon: 'visit.last' });
  }
  // A WALK-IN'S RECORD (OR-26): found again by the number or the mail the
  // desk typed once, and said to have no profile — the last fact, in ink
  // like the others, never a badge competing with «Вече е клиент».
  if (client.noAccount) {
    lines.push({
      text: words.noAccount,
      icon: 'account.anonymous',
      testId: `staff-visit-client-no-account-${client.id}`,
    });
  }
  return {
    ...client,
    selected: chosen.has(client.id),
    locked: input.pinned === client.id,
    exact,
    titleParts:
      markedRuns(ClientQuerySystem.nameSegments(client.label, parsed)) ?? null,
    lines,
  };
}

/** The field's own glyph says what it took the typing for. */
export function searchGlyphOf(shape: ClientQueryShape): UiIconName {
  return shape === ClientQueryShape.Phone
    ? 'contact.phone'
    : shape === ClientQueryShape.Email
      ? 'contact.email'
      : 'action.search';
}

/**
 * A NUMBER READ AS IT IS TYPED (owner, 2026-09-22: "translate the 0 to
 * +359 when not specifying the country code"): «088 76» prints
 * «+359 88 76» before it is whole — the trunk zero becomes the shop's
 * dial code, a «+…» or «00…» keeps the code it carries — and a whole
 * number prints the way the profile prints it. The kernel's as-you-type
 * formatter, fed the international form.
 */
function phoneAsTyped(parsed: ParsedClientQuery, callingCode: string): string {
  const [international] = ClientQuerySystem.phoneInternationalDigits(
    parsed,
    callingCode,
  );
  if (international === undefined) return parsed.phoneTyped;
  return PhoneSystem.formatDraft(`+${international}`, null).formatted;
}

/**
 * THE CREATE ROW SAYS WHAT IT WILL ASSIGN: every detected part with its
 * glyph — the name as typed, the number printed the way the profile
 * prints it once it is a whole number, the mail — so the desk sees the
 * form it is about to open before opening it.
 */
export function createPartsOf(
  parsed: ParsedClientQuery,
  callingCode: string,
): readonly CreatePart[] {
  const parts: CreatePart[] = [];
  if (parsed.name.length > 0) {
    parts.push({
      clientQueryShape: ClientQueryShape.Name,
      icon: 'contact.person',
      value: parsed.name,
    });
  }
  if (parsed.phoneTyped.length > 0) {
    parts.push({
      clientQueryShape: ClientQueryShape.Phone,
      icon: 'contact.phone',
      value: phoneAsTyped(parsed, callingCode),
    });
  }
  if (parsed.email.length > 0) {
    parts.push({
      clientQueryShape: ClientQueryShape.Email,
      icon: 'contact.email',
      value: parsed.email,
    });
  }
  return parts;
}

/** The create row's facts: every detected part on its own line. */
export function createLinesOf(
  parts: readonly CreatePart[],
): readonly StaffEventLine[] {
  return parts.map((part) => ({
    text: part.value,
    icon: part.icon,
    testId: `staff-visit-new-client-${clientQueryShapeWords[part.clientQueryShape]}`,
  }));
}

/** The create row, spoken: «Нов клиент», or «Нов клиент: Мария, +359 88 76». */
export function createRowNameOf(
  parts: readonly CreatePart[],
  words: VisitEditorWords,
): string {
  return parts.length === 0
    ? words.newClient
    : words.newClientParts(parts.map((part) => part.value).join(', '));
}
