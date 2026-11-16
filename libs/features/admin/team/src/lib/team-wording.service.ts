import { Injectable, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { TranslocoService } from '@jsverse/transloco';
import { type PipelineError, PipelineErrorCode } from '@core/errors';
import { Locale, Tag } from '@core/primitives';
import {
  DEFAULT_LOCALE,
  loadedLanguage,
  wordPipelineError,
} from '@creativo/infrastructure/i18n';
import { type AccountWords, accountWordsOf } from './account.words';
import {
  type BarberAccountWords,
  barberAccountWordsOf,
} from './barber-account.words';
import { type LinkWords, linkWordsOf } from './link.words';
import { type MemberWords, memberWordsOf } from './member.words';
import { type OfferingWords, offeringWordsOf } from './offerings.words';
import { type RoleAddWords, roleAddWordsOf } from './role-add.words';
import { type TeamWords, teamWordsOf } from './team.words';

/**
 * THE TEAM SCREENS' WORDS, in the language the catalogue has loaded — built
 * once and read by the three pages, so no lookup inside a `computed` can
 * start a load and every line re-words when the language switches
 * (`loadedLanguage`).
 */
@Injectable({ providedIn: 'root' })
export class TeamWording {
  private readonly transloco = inject(TranslocoService);

  private readonly loadedLang = toSignal(loadedLanguage(this.transloco), {
    initialValue: null,
  });

  /** The language the pages are worded in; the default until the catalogue loads. */
  readonly locale = computed<Locale>(() => {
    const lang = this.loadedLang();
    return Tag.has(Locale, lang) ? lang : DEFAULT_LOCALE;
  });

  /** Every word the pages print; `null` until the catalogue has loaded. */
  readonly words = computed<TeamWords | null>(() => {
    const lang = this.loadedLang();
    return lang === null
      ? null
      : teamWordsOf((key, params) =>
          this.transloco.translate(key, { ...params }, lang),
        );
  });

  /** The words a member's page prints from values; `null` until the catalogue has loaded. */
  readonly memberWords = computed<MemberWords | null>(() => {
    const lang = this.loadedLang();
    return lang === null
      ? null
      : memberWordsOf((key, params) =>
          this.transloco.translate(key, { ...params }, lang),
        );
  });

  /** The words a staff account's page prints from values; `null` until the catalogue has loaded. */
  readonly accountWords = computed<AccountWords | null>(() => {
    const lang = this.loadedLang();
    return lang === null
      ? null
      : accountWordsOf((key, params) =>
          this.transloco.translate(key, { ...params }, lang),
        );
  });

  /** The words the account link's acts print from values; `null` until the catalogue has loaded. */
  readonly linkWords = computed<LinkWords | null>(() => {
    const lang = this.loadedLang();
    return lang === null
      ? null
      : linkWordsOf((key, params) =>
          this.transloco.translate(key, { ...params }, lang),
        );
  });

  /** The words «Нов бръснар»'s account step prints; `null` until the catalogue has loaded. */
  readonly barberAccountWords = computed<BarberAccountWords | null>(() => {
    const lang = this.loadedLang();
    return lang === null
      ? null
      : barberAccountWordsOf((key, params) =>
          this.transloco.translate(key, { ...params }, lang),
        );
  });

  /** The words «Добави в екипа» prints from values; `null` until the catalogue has loaded. */
  readonly roleAddWords = computed<RoleAddWords | null>(() => {
    const lang = this.loadedLang();
    return lang === null
      ? null
      : roleAddWordsOf((key, params) =>
          this.transloco.translate(key, { ...params }, lang),
        );
  });

  /** The words «Услуги и цени» prints from values; `null` until the catalogue has loaded. */
  readonly offeringWords = computed<OfferingWords | null>(() => {
    const lang = this.loadedLang();
    return lang === null
      ? null
      : offeringWordsOf((key, params) =>
          this.transloco.translate(key, { ...params }, lang),
        );
  });

  /**
   * A refused call in the catalogue's most specific words (`errors.<code>`,
   * one level deeper by capability), the generic line when it has none.
   */
  refusalOf(error: PipelineError): string {
    const lang = this.locale();
    return wordPipelineError(
      error,
      (code, params) => {
        const key = `errors.${code}`;
        const worded = this.transloco.translate(key, params, lang);
        return worded === key ? code : worded;
      },
      PipelineErrorCode.Unknown,
    );
  }
}
