/** Where one part of a stacked bar begins and ends, in the bar's own units. */
export type StackOffset = { readonly start: number; readonly end: number };

/**
 * THE CUMULATIVE OFFSETS OF A STACKED BAR — part `i` runs from the sum of
 * the parts before it to that sum plus its own value. A negative value
 * counts as 0 (a part of a stack has no length to take away); the last
 * `end` is the bar's total. Display geometry: which parts and how much
 * were decided by the system that built the bar.
 */
export function stackOffsets(
  values: readonly number[],
): readonly StackOffset[] {
  const offsets: StackOffset[] = [];
  let running = 0;
  for (const value of values) {
    const start = running;
    running += value > 0 ? value : 0;
    offsets.push({ start, end: running });
  }
  return offsets;
}

/** The stack's total: the last offset's end, 0 for no parts. */
export function stackTotal(values: readonly number[]): number {
  let total = 0;
  for (const value of values) total += value > 0 ? value : 0;
  return total;
}
