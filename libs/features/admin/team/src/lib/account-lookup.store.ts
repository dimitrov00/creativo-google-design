import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import type { User } from '@core/entities';
import {
  ClientQuerySystem,
  PhoneSystem,
  SearchFieldsSystem,
} from '@core/systems';
import {
  AUTH_DEPLOYMENT_PORTS,
  USER_SEARCH_PORTS,
} from '@creativo/infrastructure/firebase-app';

/** How long the typing must rest before the index is asked. */
const LOOKUP_DEBOUNCE_MS = 250;
/** The most accounts one key is answered with. */
const LOOKUP_LIMIT = 20;

/**
 * THE ACCOUNT LOOKUP of «Свържи профил» (team onboarding D8): what was
 * typed, read as the staff client search reads it (`ClientQuerySystem` — a
 * mail, a number in every form it is said, else the longest word of a
 * name), asked of the accounts' index and merged. Debounced, so a typed
 * name is one question; sequenced, so an answer that comes back late never
 * replaces the answer to a newer query.
 *
 * It answers the accounts as stored. Who of them a record may be linked to
 * is `RoleAssignmentSystem.linkCandidatesOf`'s to say, not this store's.
 * Provided by the sheet: one lookup per opening.
 */
@Injectable()
export class AccountLookupStore {
  private readonly search = inject(USER_SEARCH_PORTS);
  /** The shop's dial code, the query's own default when its country has none. */
  private readonly callingCode = PhoneSystem.callingCodeOr(
    inject(AUTH_DEPLOYMENT_PORTS).authDeployment.defaultCountry,
    ClientQuerySystem.DEFAULT_CALLING_CODE,
  );

  private readonly _accounts = signal<readonly User[]>([]);
  private readonly _asked = signal(false);
  private readonly _searching = signal(false);
  private readonly _failed = signal(false);
  private seq = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;

  /** The accounts the lookup in force found, each once, in the index's order. */
  readonly accounts = this._accounts.asReadonly();
  /** A lookup is in force: what was typed is something the index can be asked. */
  readonly asked = this._asked.asReadonly();
  /** The lookup in force has not answered yet. */
  readonly searching = this._searching.asReadonly();
  /** The lookup in force could not be read at all. */
  readonly failed = this._failed.asReadonly();

  constructor() {
    inject(DestroyRef).onDestroy(() => this.rest());
  }

  /** What was typed: asked once the typing rests, or dropped when it asks nothing. */
  ask(query: string): void {
    this.rest();
    const seq = ++this.seq;
    const prefixes = ClientQuerySystem.lookupKeys(
      ClientQuerySystem.parse(query),
      this.callingCode,
    )
      .map((key) => SearchFieldsSystem.normalizeQuery(key))
      .filter((prefix) => prefix.length > 0);
    this._failed.set(false);
    if (prefixes.length === 0) {
      this._accounts.set([]);
      this._asked.set(false);
      this._searching.set(false);
      return;
    }
    this._asked.set(true);
    this._searching.set(true);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.run(prefixes, seq);
    }, LOOKUP_DEBOUNCE_MS);
  }

  private async run(prefixes: readonly string[], seq: number): Promise<void> {
    const answers = await Promise.all(
      prefixes.map((prefix) => this.search.searchUsers(prefix, LOOKUP_LIMIT)),
    );
    // A newer query owns the answer now.
    if (seq !== this.seq) return;
    const accounts: User[] = [];
    let read = false;
    for (const answer of answers) {
      if (!answer.ok) continue;
      read = true;
      for (const account of answer.value) {
        if (!accounts.some((held) => held.id === account.id)) {
          accounts.push(account);
        }
      }
    }
    this._accounts.set(accounts);
    this._failed.set(!read);
    this._searching.set(false);
  }

  /** The question waiting on the typing to rest is dropped. */
  private rest(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }
}
