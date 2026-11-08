/**
 * THE SIGN-IN CALLABLES, WARM BEFORE THE FIRST TEST (2026-11-08).
 *
 * The Functions emulator runs one worker process per callable per request in
 * flight, and keeps an idle worker for the next request. A request that finds
 * no idle worker starts one: a new Node process that loads the whole
 * functions build. Under the full suite that cold start measured three to
 * four and a half seconds per callable.
 *
 * The auth specs pay it at the worst moment. They are the run's first
 * callable users, and under `fullyParallel` the four tests of
 * `auth-onboarding.spec.ts` start together, each sending its own
 * `requestOtpChallenge`, then `verifyOtpChallenge`, then
 * `completeRegistration`. So every callable started up to one worker per
 * Playwright worker at once, each cold, on the run's most loaded seconds. The
 * two cold round trips alone outlasted a 5 s assertion («Проверяваме…» still
 * up), and the chain outlasted the returning-email test's 30 s.
 *
 * So the global setup starts those workers itself: `concurrency` requests at
 * once to each callable (the run's worker count), and waits for every
 * answer. A request carries no data and no App Check token, so each callable
 * refuses it. The refusal is answered inside the worker, so the worker is up
 * and loaded once it arrives, and no challenge or account is made.
 *
 * The callables are the sign-in flow's alone: the others are first called
 * later in the run, by specs whose callable waits already allow a cold start
 * (20 s), and warming all of them would hold a worker process per callable
 * for the whole run.
 */
export const SIGN_IN_CALLABLES = [
  'requestOtpChallenge',
  'verifyOtpChallenge',
  'completeRegistration',
] as const;

/** One request may wait this long for a cold worker before the run refuses. */
const WARM_TIMEOUT_MS = 60_000;

/** Where the functions emulator listens, from the emulator hub's listing. */
async function functionsOrigin(): Promise<string> {
  const hub = process.env['FIREBASE_EMULATOR_HUB'] ?? '127.0.0.1:4400';
  const response = await fetch(`http://${hub}/emulators`, {
    signal: AbortSignal.timeout(WARM_TIMEOUT_MS),
  });
  const listing = (await response.json()) as {
    functions?: { host?: string; port?: number };
  };
  const port = listing.functions?.port;
  if (!port)
    throw new Error(`the emulator hub at ${hub} runs no functions emulator`);
  const host = listing.functions?.host ?? '127.0.0.1';
  // The hub may list the wildcard address; a request needs a real one.
  return `http://${host === '0.0.0.0' || host === '::' ? '127.0.0.1' : host}:${port}`;
}

/**
 * Starts `concurrency` workers for each sign-in callable and resolves with
 * the milliseconds it took, once every request has been answered. Refuses
 * when a request gets no HTTP answer at all.
 */
export async function warmSignInCallables(
  concurrency: number,
): Promise<number> {
  const started = Date.now();
  const project = process.env['GCLOUD_PROJECT'] ?? 'demo-creativo-test';
  const origin = await functionsOrigin();
  await Promise.all(
    SIGN_IN_CALLABLES.flatMap((name) =>
      Array.from({ length: Math.max(1, concurrency) }, async () => {
        const response = await fetch(
          `${origin}/${project}/us-central1/${name}`,
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ data: {} }),
            signal: AbortSignal.timeout(WARM_TIMEOUT_MS),
          },
        );
        // A refusal is the expected answer; only its arrival matters.
        await response.arrayBuffer();
      }),
    ),
  );
  return Date.now() - started;
}
