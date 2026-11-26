/**
 * The keyboard model of a radio group, once, for every control that is one
 * (`ui-segmented-control`, `ui-choice-tiles`): the arrows move the check and
 * wrap, Home and End jump to the ends, and the group is ONE tab stop — the
 * WAI-ARIA radio group pattern, which is also what native radios do.
 *
 * Pure arithmetic over the options that can be chosen: a control filters its
 * disabled options out first, calls this, emits the pick and moves focus.
 */

/** What these functions need to know about an option. */
export interface RadioGroupOption {
  readonly id: string;
  readonly disabled?: boolean;
}

/**
 * The index the check moves to when `key` is pressed, among `count` options
 * that can be chosen, with the check now at `current` (`-1` for none).
 * `null` for a key that moves nothing, or when nothing can be chosen.
 *
 * With nothing checked, forward lands on the first option and backward on
 * the last, the way a native group answers its first arrow.
 */
export function radioGroupStep(
  key: string,
  current: number,
  count: number,
): number | null {
  if (count <= 0) return null;
  switch (key) {
    case 'ArrowRight':
    case 'ArrowDown':
      return current < 0 ? 0 : (current + 1) % count;
    case 'ArrowLeft':
    case 'ArrowUp':
      return current < 0 ? count - 1 : (current - 1 + count) % count;
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    default:
      return null;
  }
}

/**
 * The option that holds the group's one tab stop: the checked one, else the
 * first that can be chosen; `null` when none can. Every other option takes
 * `tabindex="-1"`, so Tab enters the group once and leaves it once.
 */
export function radioGroupTabStop(
  options: readonly RadioGroupOption[],
  selectedId: string | null,
): string | null {
  const selected = options.find((option) => option.id === selectedId);
  if (selected !== undefined && !selected.disabled) return selected.id;
  return options.find((option) => !option.disabled)?.id ?? null;
}
