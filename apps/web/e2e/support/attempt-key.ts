import type { TestInfo } from '@playwright/test';

/**
 * The key for the data ONE attempt of ONE test writes — the uids it seeds,
 * the emails it registers, the documents it books: unique per test and
 * project, per `--repeat-each` copy and per retry.
 *
 * The test id alone is not that key. A retry keeps it, so a retry met the
 * account its failed predecessor had registered (a "new" email that is
 * already a returning one) or the booking it had committed (`toHaveLength(1)`
 * counting two). And whether a `--repeat-each` copy gets its own id is
 * Playwright's implementation, not its contract. So the repeat index and the
 * retry are stated, and every copy and every attempt writes its own data on
 * one long-lived emulator, as the official scripts' empty ones never needed.
 *
 * Lower-case letters and digits only, 16 of the test id's hash: it goes into
 * uids, document ids and email local parts.
 */
export function attemptKey(info: TestInfo): string {
  const test = info.testId
    .replace(/[^A-Za-z0-9]/g, '')
    .slice(-16)
    .toLowerCase();
  return `${test}x${info.repeatEachIndex}r${info.retry}`;
}
