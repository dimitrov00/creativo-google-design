import { randomUUID } from 'node:crypto';
import { IdGenerator } from '@creativo/application/shared';

/**
 * Server-side ids, from Node's CSPRNG.
 *
 * Deliberately NOT Firestore's auto-id: the appointment's own id is the
 * document id (blueprint §0.4), so it has to exist before the write — and an
 * id minted here is the same value `reconstitute()` reads back, which is what
 * makes a round trip lossless.
 *
 * The browser has its own `CryptoIdGenerator` over `crypto.randomUUID`; this
 * is the Node twin, because `libs/infrastructure/clock` is Angular-injectable
 * and a Cloud Function has no injector.
 */
export class CryptoIdGenerator implements IdGenerator {
  next(): string {
    return randomUUID();
  }
}
