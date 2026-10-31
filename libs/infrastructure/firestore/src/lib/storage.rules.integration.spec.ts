// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  assertFails,
  assertSucceeds,
  RulesTestContext,
  RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { AccountStatus, Role } from '@core/components';
import { Collections } from '@core/entities';
import { createStorageRulesTestEnv } from '../testing/emulator-test-env';

/*
 * The root `storage.rules` on the REAL Storage emulator (security hardening
 * Phase 4, WS-C — S-RU-4, S-L-11, S-L-12, S-DEP-4): an erased account's
 * still-valid ID token (≤ 1 h after its Auth user is deleted) uploads no
 * avatar. The avatar write reads `users/{uid}.accountStatus` across
 * services (`accountMayUpload`, one `firestore.get`, last): `ERASED` and a
 * missing `users` document are refused; a delete stays the owner's; a
 * `BLOCKED` account still uploads. Beside it, the pins this file never had:
 * the 5 MiB cap, the image type, anonymous and foreign writers, the public
 * avatar read, the visit photos' staff-only gate and the default-deny root.
 *
 * The Storage emulator answers a rule's `firestore.get` from the Firestore
 * data of the project it runs under (`demo-creativo-test`,
 * `createStorageRulesTestEnv`), so the accounts are seeded there — with
 * run-unique uids, deleted in `afterAll` with every object this file
 * wrote. The objects live in a bucket of this file's own (`BUCKET`): the
 * functions' erasure proof lists and empties the app's default bucket, and
 * the rules match every bucket alike.
 *
 * The emulator judges every upload as `create` — an overwrite too — and
 * judges only a metadata change as `update`; both are driven below.
 * Node environment: the uploads need no DOM.
 */

/** This file's own bucket — never the app's `demo-creativo-test.appspot.com`. */
const BUCKET = 'gs://demo-creativo-test-storage-rules';

/** A run-unique stem: the accounts live in a project other suites share. */
const RUN = randomUUID().slice(0, 8);
const ACTIVE = `storage-rules-${RUN}-active`;
const ERASED = `storage-rules-${RUN}-erased`;
const BLOCKED = `storage-rules-${RUN}-blocked`;
/** A signed-in uid with no `users` document. */
const NO_ACCOUNT = `storage-rules-${RUN}-no-account`;
const BARBER = `storage-rules-${RUN}-barber`;
const APPOINTMENT = `storage-rules-${RUN}-appointment`;

const SEEDED_ACCOUNTS: ReadonlyArray<readonly [string, AccountStatus]> = [
  [ACTIVE, AccountStatus.Active],
  [ERASED, AccountStatus.Erased],
  [BLOCKED, AccountStatus.Blocked],
];
/** Every prefix this file may write under — emptied in `afterAll`. */
const WRITTEN_PREFIXES: readonly string[] = [
  ...[ACTIVE, ERASED, BLOCKED, NO_ACCOUNT].map((uid) => `avatars/${uid}`),
  `appointmentPhotos/${APPOINTMENT}`,
  `unlisted/${ACTIVE}`,
];

/** The eight bytes of the PNG signature — an image body as small as can be. */
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const IMAGE = { contentType: 'image/png' } as const;
/** Exactly the cap: the rule admits `size < 5 MiB` only. */
const FIVE_MIB = new Uint8Array(5 * 1024 * 1024);

const avatarOf = (uid: string): string => `avatars/${uid}/original`;

describe('storage.rules (emulator)', () => {
  let testEnv: RulesTestEnvironment;

  beforeAll(async () => {
    testEnv = await createStorageRulesTestEnv();
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      for (const [uid, accountStatus] of SEEDED_ACCOUNTS) {
        await ctx
          .firestore()
          .collection(Collections.Users)
          .doc(uid)
          .set({ accountStatus });
      }
    });
  });

  afterAll(async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      for (const prefix of WRITTEN_PREFIXES) {
        const { items } = await ctx.storage(BUCKET).ref(prefix).listAll();
        await Promise.all(items.map((item) => item.delete()));
      }
      for (const [uid] of SEEDED_ACCOUNTS) {
        await ctx.firestore().collection(Collections.Users).doc(uid).delete();
      }
    });
    await testEnv.cleanup();
  });

  /** A signed-in caller whose ID token carries exactly these role claims. */
  function signedIn(uid: string, ...roles: string[]): RulesTestContext {
    return testEnv.authenticatedContext(uid, { roles });
  }

  /** An upload of `body` to `path` as `ctx` — settles when the emulator answers. */
  function upload(
    ctx: RulesTestContext,
    path: string,
    body: Uint8Array,
    contentType: string,
  ): Promise<unknown> {
    return ctx.storage(BUCKET).ref(path).put(body, { contentType }).then();
  }

  /** An object put in place past the rules (the owner's credentials). */
  async function seedObject(path: string): Promise<void> {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await upload(ctx, path, PNG, IMAGE.contentType);
    });
  }

  describe('an avatar write reads the account (S-RU-4)', () => {
    it('lets an ACTIVE owner upload, overwrite and re-describe their avatar', async () => {
      const owner = signedIn(ACTIVE, Role.Client);
      await assertSucceeds(
        upload(owner, avatarOf(ACTIVE), PNG, IMAGE.contentType),
      );
      await assertSucceeds(
        upload(owner, avatarOf(ACTIVE), PNG, IMAGE.contentType),
      );
      await assertSucceeds(
        owner
          .storage(BUCKET)
          .ref(avatarOf(ACTIVE))
          .updateMetadata({ cacheControl: 'no-cache' }),
      );
    });

    it('refuses an ERASED owner a new avatar (create)', async () => {
      await assertFails(
        upload(
          signedIn(ERASED, Role.Client),
          avatarOf(ERASED),
          PNG,
          IMAGE.contentType,
        ),
      );
    });

    it('refuses an ERASED owner an overwrite and a metadata change (update)', async () => {
      await seedObject(avatarOf(ERASED));
      const erased = signedIn(ERASED, Role.Client);
      await assertFails(
        upload(erased, avatarOf(ERASED), PNG, IMAGE.contentType),
      );
      await assertFails(
        erased
          .storage(BUCKET)
          .ref(avatarOf(ERASED))
          .updateMetadata({ cacheControl: 'no-cache' }),
      );
    });

    it('still lets an ERASED owner delete their own avatar', async () => {
      await seedObject(avatarOf(ERASED));
      await assertSucceeds(
        signedIn(ERASED, Role.Client)
          .storage(BUCKET)
          .ref(avatarOf(ERASED))
          .delete(),
      );
    });

    it('refuses an uid with no users document (fail-closed)', async () => {
      await assertFails(
        upload(
          signedIn(NO_ACCOUNT, Role.Client),
          avatarOf(NO_ACCOUNT),
          PNG,
          IMAGE.contentType,
        ),
      );
    });

    it('leaves a BLOCKED owner able to upload (not this guard)', async () => {
      await assertSucceeds(
        upload(
          signedIn(BLOCKED, Role.Client),
          avatarOf(BLOCKED),
          PNG,
          IMAGE.contentType,
        ),
      );
    });
  });

  describe('the avatar gate as it stood', () => {
    it("refuses a write to another user's avatar", async () => {
      await assertFails(
        upload(
          signedIn(ACTIVE, Role.Client),
          avatarOf(BLOCKED),
          PNG,
          IMAGE.contentType,
        ),
      );
    });

    it('refuses an anonymous upload', async () => {
      await assertFails(
        upload(
          testEnv.unauthenticatedContext(),
          avatarOf(ACTIVE),
          PNG,
          IMAGE.contentType,
        ),
      );
    });

    it('refuses a body of 5 MiB and a body that is not an image', async () => {
      const owner = signedIn(ACTIVE, Role.Client);
      await assertFails(
        upload(owner, avatarOf(ACTIVE), FIVE_MIB, IMAGE.contentType),
      );
      await assertFails(upload(owner, avatarOf(ACTIVE), PNG, 'text/plain'));
    });

    it('lets anyone read an avatar', async () => {
      await seedObject(avatarOf(ACTIVE));
      const metadata = await assertSucceeds(
        testEnv
          .unauthenticatedContext()
          .storage(BUCKET)
          .ref(avatarOf(ACTIVE))
          .getMetadata(),
      );
      expect(metadata.contentType).toBe(IMAGE.contentType);
    });
  });

  it("keeps a visit's photos to the staff who work the book", async () => {
    const photo = `appointmentPhotos/${APPOINTMENT}/photo-1`;
    await assertSucceeds(
      upload(signedIn(BARBER, Role.Barber), photo, PNG, IMAGE.contentType),
    );
    const client = signedIn(ACTIVE, Role.Client);
    await assertFails(upload(client, photo, PNG, IMAGE.contentType));
    await assertFails(client.storage(BUCKET).ref(photo).getMetadata());
  });

  it('denies a path no rule names', async () => {
    const path = `unlisted/${ACTIVE}/file`;
    const owner = signedIn(ACTIVE, Role.Client);
    await assertFails(upload(owner, path, PNG, IMAGE.contentType));
    await assertFails(owner.storage(BUCKET).ref(path).getMetadata());
  });
});
