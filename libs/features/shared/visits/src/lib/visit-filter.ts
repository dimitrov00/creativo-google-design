import { VisitFilter, VisitPerspective } from '@core/components';
import { visitFilterWords } from '@creativo/infrastructure/i18n';

/*
 * THE FUNNEL'S WORDS (client-card redesign §5.3.1). The client's list and
 * the staff card's history narrow the same way, over rows already built.
 *
 * `all` and `upcoming` are the two axes a person actually thinks in; the
 * three terminal outcomes are there because a history is where you go
 * looking for "did I ever no-show?" — and each is an outcome the row
 * genuinely carries, so no option can ever be a lie.
 *
 * The options, their order, which are worth offering and the narrowing
 * rule are `VisitListSystem` in `@core/systems` (`filtersFor`, `offered`,
 * `matches`), over its own tags and the rows as they are (a row IS a
 * `FilterRow`); hosts call it directly. What stays here is the option's
 * key, built from its one lower-case word (`visitFilterWords`).
 */

/**
 * The option's word (`visits.filter.*`). One word differs by who reads it:
 * a client «Пропуснати» their own hour, a barber records a «Неявявания».
 */
export function visitFilterWordKey(
  filter: VisitFilter,
  perspective: VisitPerspective,
): string {
  if (filter === VisitFilter.NoShow && perspective === VisitPerspective.Staff) {
    return 'visits.filter.no_show_staff';
  }
  // eslint-disable-next-line security/detect-object-injection -- `filter` is a member of the closed dictionary the table is total over.
  return `visits.filter.${visitFilterWords[filter]}`;
}
