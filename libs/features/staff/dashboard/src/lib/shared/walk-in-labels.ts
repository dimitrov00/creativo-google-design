/**
 * NAMES FOR THE PEOPLE ON ONE VISIT WHO HAVE NONE (round 3, 2026-09-25).
 *
 * A seat for somebody the desk never named is a guest seat, and a guest is
 * nothing but its label: the sheet keys a stored guest by it
 * (`guest-<label>`), the client prefill groups people by it, and the
 * server's party check (`personKey`) reads two seats with one label as ONE
 * person. Every unlabelled person used to fall back to the same
 * «Случаен клиент», so two strangers on one visit became one — a second
 * walk-in's cut filed under the first, and the pair refused as one person
 * booked twice.
 *
 * So the first stranger keeps the plain word, and every later one on the
 * same visit is numbered — «Случаен клиент 2», «Случаен клиент 3» — skipping
 * any label the visit already holds, whoever holds it. The same person
 * (one id, however many legs) is named once.
 *
 * `word(null)` is the plain label, `word(n)` the numbered one; the caller
 * supplies both from the catalogue. The search is bounded, so a catalogue
 * that words every number alike still ends.
 */
export function walkInLabels(
  unlabelled: readonly string[],
  taken: Iterable<string>,
  word: (number: number | null) => string,
): ReadonlyMap<string, string> {
  const used = new Set(taken);
  const labels = new Map<string, string>();
  const people = [...new Set(unlabelled)];
  const limit = used.size + people.length + 2;
  for (const id of people) {
    let label = word(null);
    for (let number = 2; used.has(label) && number <= limit; number += 1) {
      label = word(number);
    }
    labels.set(id, label);
    used.add(label);
  }
  return labels;
}
