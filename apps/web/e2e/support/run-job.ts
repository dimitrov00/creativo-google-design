/**
 * The scheduled jobs an e2e flow drives, named by their `run<Job>` handler:
 * `expireClientPauses` for E4, `expireApprovals` for E8 (design §12.6.8).
 */
export type JobName = 'expireClientPauses' | 'expireApprovals';

/**
 * Runs one scheduled job as if the clock read `nowIso`.
 *
 * Scheduled functions never fire in the emulator (rebuild-capacity.ts), so
 * each `onSchedule` export wraps an exported `run<Job>(db, now)` handler that
 * tests call directly (design §12.0-3). No such handler exists yet: the first
 * one, `runExpireClientPauses`, ships in P2, and that phase wires this helper
 * to call it against the emulators with the given instant.
 *
 * Until then it refuses, so a flow that depends on a job fails loudly
 * instead of asserting on a state no job produced.
 */
export async function runJob(name: JobName, nowIso: string): Promise<void> {
  throw new Error(
    `runJob('${name}', '${nowIso}') is not wired until P2: no run<Job> handler exists yet`,
  );
}
