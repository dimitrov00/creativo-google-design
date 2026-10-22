/**
 * `@creativo/application/engagement/testing` — TEST SUPPORT, never
 * production API.
 *
 * What is left of the legacy engagement lib's test support until Phase 4
 * deletes the lib: the gift vouchers (client-card-revision-3 §4.5), the one
 * half the loyalty flip (3) did not reshape. The voucher documents live in
 * `@core/testing` (`libs/ecs-core/src/testing/fixtures/loyalty/vouchers.json`,
 * where the dev seed reads them by path) and the day they are true on is its
 * `FIXTURE_TODAY`; this entry hands them out typed as the wire's
 * documents, behind its own entry point so the production barrel
 * (`@creativo/application/engagement`) can never hand one to a provider.
 *
 * Beside them, the vouchers port's in-memory reference
 * (`InMemoryClientVouchersReader`): it holds DOCUMENTS and answers through
 * the mapper the Firestore adapter uses.
 */
import type { GiftVoucher } from '@creativo/domain/engagement';
import { type Result, fail, ok } from '@creativo/domain/kernel';
import { RepositoryError } from '@creativo/application/shared';
import type { ClientVouchersReader } from './lib/ports/client-vouchers-reader.port';
import {
  GIFT_VOUCHERS_COLLECTION,
  GIFT_VOUCHER_HOLDER_FIELD,
  type GiftVoucherDocument,
  type GiftVoucherFields,
  giftVoucherFromDocument,
} from './lib/ports/gift-voucher-document';
// Test support importing test support — never production code (the lib's
// eslint config gives this entry the specs' import rule).
import { deepFreeze, giftVouchersJson } from '@core/testing';

/** `giftVouchers/{id}`, keyed by document id. */
export type GiftVouchersFixture = Readonly<Record<string, GiftVoucherFields>>;

/**
 * A document as JSON can spell it: every closed vocabulary widened to its
 * primitive. JSON has no literal types, so this is the strictest shape the
 * compiler can hold a fixture file to — keys, nesting, nullability and
 * primitive kinds; `testing.spec.ts` checks the vocabulary at run time.
 */
type Json<T> = T extends string
  ? string
  : T extends number
    ? number
    : T extends boolean
      ? boolean
      : T extends null
        ? null
        : T extends readonly (infer Item)[]
          ? readonly Json<Item>[]
          : { readonly [K in keyof T]: Json<T[K]> };

/** Checked against its documents' shape, then typed as them. */
function fixture<T>(json: Json<T>): T {
  return json as unknown as T;
}

/**
 * Five gift vouchers, keyed by document id, true on `FIXTURE_TODAY`.
 * Георги (`dev-client-1`) holds three: `GIFT50`, 25,00 € left of 50,00 €
 * until the end of 31.12.2026, one he spent and one the shop voided.
 * Мартин (`dev-client-2`) holds `GIFT2025`, whole. `GIFT5` is paper:
 * nobody's until its code is presented. Shared by every spec in a worker,
 * so frozen all the way down.
 */
export const giftVoucherFixtures: GiftVouchersFixture = deepFreeze(
  fixture<{
    readonly [GIFT_VOUCHERS_COLLECTION]: GiftVouchersFixture;
  }>(giftVouchersJson).giftVouchers,
);

// ── A person's gift vouchers (client-card-revision-3 §4.5) ──────────────

/**
 * `ClientVouchersReader` over voucher documents, the fixture's unless
 * said: the query the adapter runs (`issuedToUserId ==`), then the wire's
 * reader. Whatever their state; a paper voucher is nobody's.
 */
export class InMemoryClientVouchersReader implements ClientVouchersReader {
  /** Every read, in order. */
  readonly calls: { readonly userId: string }[] = [];
  private readonly documents: Map<string, GiftVoucherDocument>;
  private failure: RepositoryError | null = null;

  /** `giftVouchers`, keyed by document id. */
  constructor(documents: Readonly<Record<string, GiftVoucherDocument>> = {}) {
    this.documents = new Map(Object.entries(documents));
  }

  /** The five vouchers of the fixture: three of Георги's, Мартин's one, one on paper. */
  static seeded(): InMemoryClientVouchersReader {
    return new InMemoryClientVouchersReader(giftVoucherFixtures);
  }

  /** Issues, or replaces, one voucher. */
  put(id: string, document: GiftVoucherDocument): this {
    this.documents.set(id, document);
    return this;
  }

  /** Every read answers this error until `recover()`: the holdings' failed state. */
  failWith(error = new RepositoryError('The vouchers are unavailable')): this {
    this.failure = error;
    return this;
  }

  recover(): this {
    this.failure = null;
    return this;
  }

  async listForHolder(
    userId: string,
  ): Promise<Result<readonly GiftVoucher[], RepositoryError>> {
    this.calls.push({ userId });
    if (this.failure !== null) return fail(this.failure);
    const held: GiftVoucher[] = [];
    for (const [id, document] of this.documents) {
      const holder = new Map(Object.entries(document)).get(
        GIFT_VOUCHER_HOLDER_FIELD,
      );
      if (holder !== userId) continue;
      const voucher = giftVoucherFromDocument(id, document);
      // A document that is no voucher costs nobody the rest of theirs.
      if (voucher !== null) held.push(voucher);
    }
    return ok(held);
  }
}
