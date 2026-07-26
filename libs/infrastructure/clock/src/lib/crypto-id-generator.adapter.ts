import { Injectable } from '@angular/core';
import { IdGenerator } from '@creativo/application/shared';

/** `IdGenerator` backed by the platform's `crypto.randomUUID()` — the one
 *  place a fresh id crosses from "nothing" into a use-case, so entity
 *  construction stays deterministic and replayable under test. */
@Injectable()
export class CryptoIdGenerator implements IdGenerator {
  next(): string {
    return crypto.randomUUID();
  }
}
