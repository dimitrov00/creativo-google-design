#!/usr/bin/env node
/**
 * The P0 exit criteria (client-details design §12.4 P0) that no single spec
 * can carry, proved against the WHOLE local stack — firestore, auth,
 * functions and storage emulators, the functions built and their flag env
 * written, the way `pnpm run dev` starts them:
 *
 *   pnpm run verify:p0
 *
 * (a) `pnpm run seed:dev` succeeds twice, and the second run writes the same
 *     appointments, users, client records and client stats as the first.
 * (b) Two backfill runs (the `runBackfill` callable, as a sysadmin) leave
 *     every `clientStats/{customerId}` and `restricted/money` document
 *     byte-equal apart from `updatedAtUtcMs`; the second run writes nothing.
 * (c) The seed's stats equal the backfill's for every seeded subject — every
 *     client RECORD a seat names (`subjectCustomerIds`, D29): the stats are
 *     deleted and rebuilt from the appointments alone, then compared with
 *     what the seed wrote.
 * (d) A staff edit of the seeded party of two (`staffEditAppointment` as
 *     dev-staff-ivan) writes one audit row per account person, each naming
 *     that person's client record as `targetCustomerId`, attributed to Ivan
 *     as `ADMIN`. The party is re-read on its flat keys (`utcEpochMs`,
 *     `localDate`, `startMinutes`); the callable's move payload keeps its
 *     frozen wire (`startIso`, flip-1 plan F1-3).
 * (e) A profile name change is audited by field name only, BOTH ways
 *     (flip-2 plan F2-5): a client renaming themselves (a rules-checked
 *     owner write) and the `updateProfile` callable putting the name back
 *     each leave exactly one `PROFILE_UPDATED` row whose `profileFields`
 *     name the field and that holds no value — the rename credited to the
 *     client (`USER`), the callable's Admin SDK write to
 *     `SYSTEM`/`ADMIN_SDK` (the plan's §10.15 default) where the event
 *     carries its writer; the Emulator Suite delivers none, so there both
 *     rows must read `SYSTEM`/`UNATTRIBUTED_UNKNOWN` — and the restore
 *     re-derives the search keys from the stored contact, so the profile
 *     ends exactly as the seed wrote it.
 * (f) The functions build's generated `dist/apps/functions/package.json`
 *     lists exactly the runtime dependencies of
 *     `functions-deps.baseline.json` (ECS migration §6 Phase 1 gate). It
 *     needs no emulator, so it lives in `functions-deps.mjs` (this file
 *     refuses to load outside one) and also runs alone:
 *     `node tools/verify/p0/check-functions-deps.mjs`.
 *
 * Each check prints `pass` or `FAIL` with its evidence; the exit code is the
 * number of failures. The live triggers stay on throughout, as in dev: they
 * run the same state-based code as the seed and the backfill, so a trigger
 * landing between two steps can only write the same answer.
 *
 * Emulator-only by construction (the seed's own guard): refuses to run
 * unless FIRESTORE_EMULATOR_HOST points at this machine. It rebuilds
 * `clientStats` from scratch, and edits the party and dev-client-1's first
 * name, then puts both back.
 */
import { spawnSync } from 'node:child_process';
import http from 'node:http';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import admin from 'firebase-admin';
import { loadSeedDomain } from '../../seed/load-domain.mjs';
import { settleTriggers } from '../../seed/settle.mjs';
import { readCallableAnswer } from './callable-answer.mjs';
import { checkFunctionsDeps } from './functions-deps.mjs';

const WORKSPACE_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../..',
);
const PROJECT_ID = 'demo-creativo-test';
const REGION = 'us-central1';

/** `emulators:exec` may hand over the 0.0.0.0 bind address; connect locally. */
const local = (host) => host.replace('0.0.0.0', '127.0.0.1');
process.env.FIRESTORE_EMULATOR_HOST = local(
  process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8080',
);
process.env.FIREBASE_AUTH_EMULATOR_HOST = local(
  process.env.FIREBASE_AUTH_EMULATOR_HOST ?? '127.0.0.1:9099',
);
const FIRESTORE = process.env.FIRESTORE_EMULATOR_HOST;
const AUTH = process.env.FIREBASE_AUTH_EMULATOR_HOST;
const FUNCTIONS = local(
  process.env.FUNCTIONS_EMULATOR_HOST ?? '127.0.0.1:5001',
);

if (![FIRESTORE, AUTH, FUNCTIONS].every((host) => host.includes('127.0.0.1'))) {
  console.error('Refusing to run outside the local emulators.');
  process.exit(1);
}

admin.initializeApp({ projectId: PROJECT_ID });
const db = admin.firestore();

const PARTY_ID = 'appt-dev-party';
const PARTY_PEOPLE = ['dev-client-10', 'dev-client-3'];
const STAFF_UID = 'dev-staff-ivan';
const RENAMED_UID = 'dev-client-1';
const SYSADMIN_UID = 'p0-verify-sysadmin';

// ── the harness ─────────────────────────────────────────────────────────

const failures = [];

async function check(label, proof) {
  try {
    const evidence = await proof();
    console.log(`pass  ${label}${evidence ? `\n      ${evidence}` : ''}`);
  } catch (error) {
    failures.push(label);
    console.error(`FAIL  ${label}\n      ${error.message}`);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

/** Sorted keys, timestamps as ISO: one string per document, comparable byte for byte. */
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    if (typeof value.toDate === 'function') {
      return JSON.stringify(value.toDate().toISOString());
    }
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function without(data, ...keys) {
  if (data === undefined || data === null) return null;
  return Object.fromEntries(
    Object.entries(data).filter(([key]) => !keys.includes(key)),
  );
}

/** Wait for `read` to yield at least `count` items, and a moment longer for strays. */
async function waitFor(read, count, label, timeoutMs = 30_000) {
  const start = Date.now();
  for (;;) {
    const items = await read();
    if (items.length >= count) {
      await sleep(1_500);
      return read();
    }
    if (Date.now() - start > timeoutMs) {
      throw new Error(
        `${label}: ${items.length} of ${count} after ${timeoutMs} ms`,
      );
    }
    await sleep(500);
  }
}

/**
 * Until the projections stop moving: the seed's appointment writes fire
 * `dispatchClientProjections` (and the busy/capacity rebuilds) for a while
 * after the seed itself has exited. The one settle rule the e2e suite also
 * waits on (`tools/seed/settle.mjs`).
 *
 * Counted from `sinceMs`, the instant the step that set the triggers off
 * began — taken BEFORE the seed or the backfill, as the e2e suite's global
 * setup passes `--since`: a trigger that step set off and that died before
 * the settle connected is still reported by name. Left to its own default
 * (the start of the wait) the settle would see that failure replayed but
 * not count it. Required, so a new step cannot forget it.
 */
const settle = (sinceMs) => {
  assert(
    Number.isSafeInteger(sinceMs),
    'settle() takes the epoch milliseconds its step began',
  );
  return settleTriggers(db, { sinceMs });
};

// ── the stack's own doors ───────────────────────────────────────────────

/** An ID token for `uid` from the Auth emulator, claims as `verifyOtp` mints them. */
async function idTokenFor(uid, claims) {
  const token = await admin.auth().createCustomToken(uid, claims);
  const response = await fetch(
    `http://${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=demo-key`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token, returnSecureToken: true }),
    },
  );
  const body = await response.json();
  assert(response.ok, `sign-in as ${uid} refused: ${JSON.stringify(body)}`);
  return body.idToken;
}

/**
 * A callable's answer never properly came: the wait ran out, the connection
 * dropped, or what arrived was cut off or unreadable (`readCallableAnswer`).
 */
class LostAnswer extends Error {}

/** How long `callable` waits for an answer unless told otherwise. */
const CALL_TIMEOUT_MS = 120_000;

/**
 * A callable through the Functions emulator, over its wire protocol, waiting
 * up to `timeoutMs` for the answer. On `node:http`, not `fetch`: fetch
 * (undici) gives up on a response after 300 s (`headersTimeout`) whatever
 * the caller wants, and a runner must be able to outwait a callable's own
 * platform timeout. Rejects with `LostAnswer` when no answer came — or none
 * that could be read: a truncated, empty or unparseable body, or a 5xx with
 * no `error` object, is a LOST answer, not a refusal (round 3) — and with a
 * plain error only when the callable answered with a well-formed `{error}`.
 */
function callable(name, idToken, data, timeoutMs = CALL_TIMEOUT_MS) {
  const payload = JSON.stringify({ data });
  return new Promise((resolveCall, rejectCall) => {
    const lost = (why) => rejectCall(new LostAnswer(`${name}: ${why}`));
    const request = http.request(
      `http://${FUNCTIONS}/${PROJECT_ID}/${REGION}/${name}`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(payload),
          authorization: `Bearer ${idToken}`,
        },
        timeout: timeoutMs,
      },
      (response) => {
        let text = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => {
          text += chunk;
        });
        response.on('error', (error) => lost(error.message));
        response.on('end', () => {
          const answer = readCallableAnswer({
            statusCode: response.statusCode,
            complete: response.complete,
            text,
          });
          if (answer.kind === 'result') resolveCall(answer.result);
          else if (answer.kind === 'refusal') {
            rejectCall(
              new Error(`${name} refused: ${JSON.stringify(answer.error)}`),
            );
          } else lost(answer.why);
        });
      },
    );
    request.on('timeout', () =>
      request.destroy(new Error(`no answer within ${timeoutMs} ms`)),
    );
    request.on('error', (error) => lost(error.message));
    request.end(payload);
  });
}

/** A client-SDK-equivalent write: the REST API under the caller's token, so rules apply. */
async function ownerUpdate(path, fields, idToken) {
  const mask = Object.keys(fields)
    .map((key) => `updateMask.fieldPaths=${encodeURIComponent(key)}`)
    .join('&');
  const response = await fetch(
    `http://${FIRESTORE}/v1/projects/${PROJECT_ID}/databases/(default)/documents/${path}?${mask}&currentDocument.exists=true`,
    {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify({
        fields: Object.fromEntries(
          Object.entries(fields).map(([key, value]) => [
            key,
            { stringValue: value },
          ]),
        ),
      }),
    },
  );
  assert(
    response.ok,
    `owner write to ${path} refused: ${await response.text()}`,
  );
}

function runSeed() {
  const run = spawnSync(
    process.execPath,
    [join(WORKSPACE_ROOT, 'tools/seed-dev-catalog.mjs')],
    {
      cwd: WORKSPACE_ROOT,
      env: process.env,
      encoding: 'utf8',
    },
  );
  const tail = `${run.stdout ?? ''}${run.stderr ?? ''}`
    .trim()
    .split('\n')
    .slice(-3)
    .join(' / ');
  assert(run.status === 0, `seed exited ${run.status}: ${tail}`);
  return tail;
}

/** Every stats pair by client record, content only when asked: `updatedAtUtcMs` (and `version`) dropped. */
async function statsBook() {
  const stats = await db.collection('clientStats').get();
  const money = stats.empty
    ? []
    : await db.getAll(
        ...stats.docs.map((doc) =>
          doc.ref.collection('restricted').doc('money'),
        ),
      );
  return new Map(
    stats.docs.map((doc, index) => [
      doc.id,
      { stats: doc.data(), money: money[index]?.data() ?? null },
    ]),
  );
}

function bookBytes(book, ...dropped) {
  return new Map(
    [...book].map(([uid, pair]) => [
      uid,
      canonical({
        stats: without(pair.stats, ...dropped),
        money: without(pair.money, ...dropped),
      }),
    ]),
  );
}

function differing(left, right) {
  const ids = [...new Set([...left.keys(), ...right.keys()])].sort();
  return ids.filter((id) => left.get(id) !== right.get(id));
}

async function collectionBytes(name) {
  const snapshot = await db.collection(name).get();
  return new Map(snapshot.docs.map((doc) => [doc.id, canonical(doc.data())]));
}

/** Every client record a seat names — whom the stats are kept for (D29). */
async function seededSubjects() {
  const appointments = await db.collection('appointments').get();
  return [
    ...new Set(
      appointments.docs.flatMap((doc) => doc.get('subjectCustomerIds') ?? []),
    ),
  ].sort();
}

/** The fields of the stamp a policy pass leaves on a stats document. */
const POLICY_PASS_FIELDS = [
  'policyPassGeneration',
  'policyPassChangedAtSeconds',
  'policyPassChangedAtNanos',
];

/**
 * How long the runner waits on one `runBackfill` call: past the callable's
 * platform timeout (`RUN_BACKFILL_TIMEOUT_SECONDS`, 540 s), so it never
 * walks away from a call the server is still working on and then calls
 * again on top of it. The call's own budget (`RUN_BACKFILL_BUDGET_MS`,
 * 49 s) is what makes the answer come in under a minute.
 */
const BACKFILL_CALL_TIMEOUT_MS = 600_000;

/** Lost answers in a row a run shrugs off before it gives up. */
const BACKFILL_LOST_ANSWERS = 3;

/**
 * One whole `clientStats` run, page after page, from the top.
 *
 * A call whose answer is lost is not re-sent: the next call goes WITHOUT a
 * cursor, and the server continues from its progress document
 * (`backfillJobs/clientStats`) — wherever the lost call got to, or where
 * it started if it got nowhere. The run's totals are read from that same
 * document at the end, so a lost answer costs no count.
 */
async function backfillRun(idToken) {
  let request = { job: 'clientStats', cursor: null };
  let lost = 0;
  for (;;) {
    let page;
    try {
      page = await callable(
        'runBackfill',
        idToken,
        request,
        BACKFILL_CALL_TIMEOUT_MS,
      );
    } catch (error) {
      if (!(error instanceof LostAnswer) || ++lost > BACKFILL_LOST_ANSWERS) {
        throw error;
      }
      console.warn(
        `      ${error.message}; resuming from the progress document`,
      );
      request = { job: 'clientStats' };
      continue;
    }
    lost = 0;
    if (page.done) break;
    request = { job: 'clientStats', cursor: page.cursor };
  }
  const progress = (await db.doc('backfillJobs/clientStats').get()).data();
  assert(
    progress?.finishedAtUtcMs != null,
    `the run ended unfinished: ${canonical(progress)}`,
  );
  return {
    processed: progress.processed,
    recomputed: progress.recomputed,
    stamped: progress.stamped,
    sample:
      progress.sampleChecked === null
        ? null
        : {
            checked: progress.sampleChecked,
            mismatched: progress.sampleMismatched ?? [],
          },
  };
}

async function auditRowIds() {
  return new Set(
    (await db.collection('auditLog').select().get()).docs.map((doc) => doc.id),
  );
}

/** The rows `where` matches that were not there in `seen`. */
async function newAuditRows(seen, field, value) {
  const rows = await db.collection('auditLog').where(field, '==', value).get();
  return rows.docs.filter((doc) => !seen.has(doc.id)).map((doc) => doc.data());
}

/**
 * The callable's frozen wire start (F1-3): an ISO instant WITH its offset,
 * which the edge reads with `ZonedTimeSystem.parseOffsetIso`. The stored
 * visit's one instant (`utcEpochMs`), moved by `minutes`, as UTC (`Z`).
 */
const wireStartOf = (utcEpochMs, minutes = 0) =>
  new Date(utcEpochMs + minutes * 60_000).toISOString();

// ── the proofs ──────────────────────────────────────────────────────────

// First: it reads only the build `verify:p0` has just run, so a stray graph
// edge is reported before the long emulator proofs.
await check(
  '(f) the functions package.json lists the recorded dependencies',
  () => checkFunctionsDeps(),
);

let seedStats = null;
let subjects = [];

await check(
  '(a) seed:dev succeeds twice and the second run changes nothing',
  async () => {
    const firstSince = Date.now();
    const first = runSeed();
    await settle(firstSince);
    const before = {
      appointments: await collectionBytes('appointments'),
      users: await collectionBytes('users'),
      customers: await collectionBytes('customers'),
      stats: bookBytes(await statsBook(), 'updatedAtUtcMs'),
    };
    const secondSince = Date.now();
    runSeed();
    await settle(secondSince);
    const after = {
      appointments: await collectionBytes('appointments'),
      users: await collectionBytes('users'),
      customers: await collectionBytes('customers'),
      stats: bookBytes(await statsBook(), 'updatedAtUtcMs'),
    };
    for (const name of ['appointments', 'users', 'customers', 'stats']) {
      const changed = differing(before[name], after[name]);
      assert(
        changed.length === 0,
        `the second run changed ${name}: ${changed.join(', ')}`,
      );
    }
    seedStats = await statsBook();
    subjects = await seededSubjects();
    return `${before.appointments.size} appointments, ${before.users.size} users, ${before.customers.size} client records, ${before.stats.size} stats pairs identical after the second run; last lines: ${first}`;
  },
);

if (seedStats === null) {
  console.error('The seed failed; nothing else can be proved.');
  process.exit(1);
}

/*
 * The sysadmin the backfill runs as: the flat registered `User` body
 * (`REGISTERED`, `ACTIVE`, the search keys `SearchFieldsSystem` derives),
 * built by the seed's own `registeredAccountBody`
 * (`tools/seed/fixtures/users.fixtures.ts`, `satisfies Body<User>`) — so
 * this account is held to the archetype like every seeded one.
 */
const { users: seedUsers } = await loadSeedDomain();
await db.doc(`users/${SYSADMIN_UID}`).set(
  seedUsers.registeredAccountBody(
    {
      firstName: 'P0',
      lastName: 'Verifier',
      phone: '+359888000000',
      email: 'p0-verify@test.local',
    },
    ['sysadmin'],
    null,
  ),
);
const sysadmin = await idTokenFor(SYSADMIN_UID, {
  stage: 'active',
  roles: ['sysadmin'],
});
let firstRun = null;

await check(
  '(c) seed stats equal the backfill output for every seeded subject',
  async () => {
    const missing = subjects.filter(
      (customerId) =>
        !seedStats.has(customerId) || seedStats.get(customerId).money === null,
    );
    assert(
      missing.length === 0,
      `the seed left subjects without stats: ${missing.join(', ')}`,
    );
    const since = Date.now();
    await db.recursiveDelete(db.collection('clientStats'));
    assert((await statsBook()).size === 0, 'clientStats did not empty');

    const run = await backfillRun(sysadmin);
    await settle(since);
    firstRun = await statsBook();
    // Bookkeeping, all of it: a stack whose owner once moved the late line
    // carries the policy pass's stamp (`policyPass*`) on the seed's stats,
    // and a rebuild from nothing has none to carry.
    const bookkeeping = ['updatedAtUtcMs', 'version', ...POLICY_PASS_FIELDS];
    const changed = differing(
      bookBytes(seedStats, ...bookkeeping),
      bookBytes(firstRun, ...bookkeeping),
    );
    assert(
      changed.length === 0,
      `seed and backfill disagree on: ${changed.join(', ')}`,
    );
    assert(
      run.sample !== null && run.sample.mismatched.length === 0,
      `the run's own sample found drift: ${JSON.stringify(run.sample)}`,
    );
    return `${subjects.length} subjects rebuilt from ${run.processed} appointments (${run.recomputed} written by the backfill, ${run.stamped} mirrors stamped); sample ${run.sample.checked} checked, 0 mismatched`;
  },
);

await check(
  '(b) a second backfill is byte-equal apart from updatedAt',
  async () => {
    assert(firstRun !== null, 'no first run to compare with');
    const since = Date.now();
    const run = await backfillRun(sysadmin);
    await settle(since);
    const secondRun = await statsBook();
    const changed = differing(
      bookBytes(firstRun, 'updatedAtUtcMs'),
      bookBytes(secondRun, 'updatedAtUtcMs'),
    );
    assert(
      changed.length === 0,
      `the second run changed: ${changed.join(', ')}`,
    );
    assert(
      run.recomputed === 0,
      `the second run rewrote ${run.recomputed} clients`,
    );
    const restricted = [...secondRun.values()].every(
      (pair) =>
        !('lifetimeSpendCents' in pair.stats) &&
        pair.money?.lifetimeSpendCents !== undefined,
    );
    assert(restricted, 'lifetime spend is not confined to restricted/money');
    return `${secondRun.size} stats pairs, 0 rewritten, 0 differing; lifetime spend only in restricted/money`;
  },
);

await check(
  '(d) a staff edit of a party of two audits each person, Ivan as admin',
  async () => {
    const ivan = await idTokenFor(STAFF_UID, {
      stage: 'active',
      roles: ['barber', 'admin'],
    });
    const party = (await db.doc(`appointments/${PARTY_ID}`).get()).data();
    assert(party !== undefined, `${PARTY_ID} is not seeded`);
    const people = [...(party.subjectUserIds ?? [])].sort();
    assert(
      canonical(people) === canonical(PARTY_PEOPLE),
      `the party seats ${people.join(', ')}`,
    );
    // Each person's client record (D29): the record a seat names, whose
    // account is that person — the key a booking act's audit row targets.
    const records = [...(party.subjectCustomerIds ?? [])].sort();
    const owners = (
      await Promise.all(
        records.map(async (id) =>
          (await db.doc(`customers/${id}`).get()).get('userId'),
        ),
      )
    ).sort();
    assert(
      records.length === PARTY_PEOPLE.length &&
        canonical(owners) === canonical(PARTY_PEOPLE),
      `the party's records ${records.join(', ')} belong to ${owners.join(', ')}`,
    );
    const original = {
      utcEpochMs: party.utcEpochMs,
      localDate: party.localDate,
      startMinutes: party.startMinutes,
    };

    const rowsFor = async (seen) =>
      (await newAuditRows(seen, 'resourceId', PARTY_ID)).filter((row) =>
        String(row.auditAction).startsWith('BOOKING_STAFF_'),
      );
    const proveRows = (rows, move) => {
      assert(
        rows.length === 2,
        `${move}: ${rows.length} rows, expected 2: ${canonical(rows)}`,
      );
      const targets = rows.map((row) => row.targetCustomerId).sort();
      assert(
        rows.every((row) => row.auditTarget === 'CUSTOMER') &&
          canonical(targets) === canonical(records),
        `${move}: targets ${targets}`,
      );
      for (const row of rows) {
        assert(
          row.actorRole === 'ADMIN' && row.actorAdminUserId === STAFF_UID,
          `${move}: actor ${row.actorRole} ${row.actorAdminUserId}`,
        );
        assert(
          row.auditAction === 'BOOKING_STAFF_MOVE',
          `${move}: action ${row.auditAction}`,
        );
      }
    };

    let seen = await auditRowIds();
    await callable('staffEditAppointment', ivan, {
      appointmentId: PARTY_ID,
      command: { kind: 'move', startIso: wireStartOf(original.utcEpochMs, 15) },
      acknowledgedOverlap: true,
    });
    proveRows(
      await waitFor(() => rowsFor(seen), 2, 'rows for the move'),
      'move',
    );
    const moved = (await db.doc(`appointments/${PARTY_ID}`).get()).data();
    assert(
      moved.utcEpochMs === original.utcEpochMs + 15 * 60_000 &&
        moved.startMinutes === original.startMinutes + 15,
      `the party did not move a quarter hour: ${moved.localDate} ${moved.startMinutes}`,
    );

    // …and back, which is a second edit of the same party.
    seen = await auditRowIds();
    await callable('staffEditAppointment', ivan, {
      appointmentId: PARTY_ID,
      command: { kind: 'move', startIso: wireStartOf(original.utcEpochMs) },
      acknowledgedOverlap: true,
    });
    const back = await waitFor(
      () => rowsFor(seen),
      2,
      'rows for the move back',
    );
    proveRows(back, 'move back');
    const restored = (await db.doc(`appointments/${PARTY_ID}`).get()).data();
    assert(
      canonical({
        utcEpochMs: restored.utcEpochMs,
        localDate: restored.localDate,
        startMinutes: restored.startMinutes,
      }) === canonical(original),
      `the party did not move back: ${restored.localDate} ${restored.startMinutes}`,
    );
    return `2 rows per edit, targetCustomerId ${records.join(' + ')} (${PARTY_PEOPLE.join(' + ')}), actor ADMIN ${STAFF_UID}`;
  },
);

/** The actor slice of an audit row: its `actor*` root keys (`Actor`, flat). */
const actorOf = (row) =>
  Object.fromEntries(
    Object.entries(row).filter(([key]) => key.startsWith('actor')),
  );

await check(
  '(e) a profile name change is audited by field name, never by value — the owner write and updateProfile',
  async () => {
    const client = await idTokenFor(RENAMED_UID, {
      stage: 'active',
      roles: ['client'],
    });
    const profile = (await db.doc(`users/${RENAMED_UID}`).get()).data();
    assert(
      profile?.registrationState === 'REGISTERED',
      `users/${RENAMED_UID} is not a registered account: ${canonical(profile)}`,
    );
    const original = profile.firstName;
    const renamed = `${original}-P0`;
    const searchKeysOf = (body) =>
      canonical({
        searchName: body.searchName,
        searchPrefixes: body.searchPrefixes,
      });

    // A profile act stays an ACCOUNT act: its row targets the user.
    const rowsFor = async (seen) =>
      (await newAuditRows(seen, 'targetUserId', RENAMED_UID)).filter(
        (row) => row.auditAction === 'PROFILE_UPDATED',
      );
    const proveRow = (rows, values, actor, how) => {
      assert(
        rows.length === 1,
        `${how}: ${rows.length} rows, expected 1: ${canonical(rows)}`,
      );
      const [row] = rows;
      assert(
        canonical(row.profileFields) === canonical(['firstName']),
        `${how}: profileFields ${canonical(row.profileFields)}`,
      );
      const bytes = canonical(row);
      const leaked = values.filter((value) => bytes.includes(value));
      assert(
        leaked.length === 0,
        `${how}: the row holds values: ${leaked.join(', ')}`,
      );
      assert(
        canonical(actorOf(row)) === canonical(actor),
        `${how}: actor ${canonical(actorOf(row))}, expected ${canonical(actor)}`,
      );
      return row;
    };

    // Who each row credits is the writer the EVENT's auth context names
    // (`AuditSystem.profileWriter`): in production the client for the owner
    // write and `SYSTEM`/`ADMIN_SDK` for the callable's Admin SDK write
    // (§10.15's default, pinned by `audit.system.spec.ts` and
    // `triggers.wire.spec.ts`). The Emulator Suite (firebase-tools 15.11)
    // delivers Firestore events with no writer context — authtype
    // `unknown`, a fake e-mail id — so there BOTH rows read
    // `SYSTEM`/`UNATTRIBUTED_UNKNOWN`, as they did before the identity flip.
    // The rename row says which world this is; the restore row must then
    // match that world's pair exactly — never a mix.
    const UNATTRIBUTED = {
      actorRole: 'SYSTEM',
      actorSystemSource: 'UNATTRIBUTED_UNKNOWN',
    };
    const ATTRIBUTED = {
      rename: { actorRole: 'USER', actorUserId: RENAMED_UID },
      restore: { actorRole: 'SYSTEM', actorSystemSource: 'ADMIN_SDK' },
    };

    // The rename: the owner's own write, which the rules still allow — the
    // trigger credits the writer the event names, the client.
    let seen = await auditRowIds();
    await ownerUpdate(`users/${RENAMED_UID}`, { firstName: renamed }, client);
    const renameRows = await waitFor(() => rowsFor(seen), 1, 'the rename row');
    const attributed =
      renameRows.length === 1 &&
      canonical(actorOf(renameRows[0])) !== canonical(UNATTRIBUTED);
    const rename = proveRow(
      renameRows,
      [original, renamed],
      attributed ? ATTRIBUTED.rename : UNATTRIBUTED,
      'the owner rename',
    );

    // The restore: the `updateProfile` callable (an Admin SDK write) —
    // credited to the system (§10.15's default), its search keys
    // re-derived from the STORED contact.
    seen = await auditRowIds();
    const answer = await callable('updateProfile', client, {
      firstName: original,
    });
    assert(
      answer?.changed === true,
      `updateProfile answered ${canonical(answer)}, expected { changed: true }`,
    );
    const restore = proveRow(
      await waitFor(() => rowsFor(seen), 1, 'the restore row'),
      [original, renamed],
      attributed ? ATTRIBUTED.restore : UNATTRIBUTED,
      'the updateProfile restore',
    );
    const restored = (await db.doc(`users/${RENAMED_UID}`).get()).data();
    assert(
      restored.firstName === original &&
        searchKeysOf(restored) === searchKeysOf(profile),
      `the profile did not end as the seed wrote it: ${canonical(restored)}`,
    );
    return `profileFields ${canonical(rename.profileFields)}; ${attributed ? 'attributed' : 'emulator, no auth context'}: rename actor ${canonical(actorOf(rename))}, restore actor ${canonical(actorOf(restore))}; resourceId ${rename.resourceId}`;
  },
);

console.log(
  failures.length === 0
    ? '\nP0 exit criteria: all proved.'
    : `\nP0 exit criteria: ${failures.length} not proved.`,
);
process.exit(failures.length);
