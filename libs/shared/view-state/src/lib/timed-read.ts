/**
 * THE READ BUDGET — one read raced against a timer, the rule the staff
 * client card and the admin rhythm page shared as two near-copies of a
 * private `timed`. Generic on purpose: this lib may import no domain
 * library, so the two failure answers are the caller's own values (each
 * store hands its `Result.err(RepositoryError.readFailed(…))` structs).
 *
 * - the read's own answer, when it settles within `budgetMs`;
 * - `failures.timedOut` once `budgetMs` passes without one (a later answer
 *   is ignored);
 * - `failures.threw` when the read throws — synchronously, or by
 *   rejecting.
 *
 * Every pending budget timer sits in `timers` until it fires or the read
 * settles, so the caller's teardown can clear them all
 * (`for (const t of timers) clearTimeout(t)`).
 */
export function timedRead<A, F>(
  read: () => Promise<A>,
  budgetMs: number,
  timers: Set<ReturnType<typeof setTimeout>>,
  failures: { readonly timedOut: F; readonly threw: F },
): Promise<A | F> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      timers.delete(timer);
      resolve(failures.timedOut);
    }, budgetMs);
    timers.add(timer);
    const settle = (answer: A | F) => {
      clearTimeout(timer);
      timers.delete(timer);
      resolve(answer);
    };
    let pending: Promise<A>;
    try {
      pending = read();
    } catch {
      settle(failures.threw);
      return;
    }
    pending.then(settle, () => settle(failures.threw));
  });
}
