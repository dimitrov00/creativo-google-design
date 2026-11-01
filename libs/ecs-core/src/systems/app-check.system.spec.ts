import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  AppCheckMode,
  AppCheckOutcome,
  AppCheckTokenUse,
  Tag,
} from '@core/primitives';
import { AppCheckErrorCode } from '@core/errors';
import { deepFreeze } from '@core/testing';
import { type AppCheckFacts, AppCheckSystem } from './app-check.system';

const { outcomeOf, verdictOf } = AppCheckSystem;

const facts = (
  appCheckTokenSent: boolean,
  appCheckTokenVerified: boolean,
  appCheckTokenReplayed: boolean,
): AppCheckFacts => ({
  appCheckTokenSent,
  appCheckTokenVerified,
  appCheckTokenReplayed,
});

/** Every one of the 8 fact combinations, with the outcome it reads as. */
const TRUTH_TABLE: readonly (readonly [AppCheckFacts, AppCheckOutcome])[] = [
  [facts(false, false, false), AppCheckOutcome.Missing],
  [facts(false, false, true), AppCheckOutcome.Missing],
  [facts(false, true, false), AppCheckOutcome.Missing],
  [facts(false, true, true), AppCheckOutcome.Missing],
  [facts(true, false, false), AppCheckOutcome.Invalid],
  [facts(true, false, true), AppCheckOutcome.Invalid],
  [facts(true, true, false), AppCheckOutcome.Valid],
  [facts(true, true, true), AppCheckOutcome.Replayed],
];

const MODES = Tag.values(AppCheckMode);
const USES = Tag.values(AppCheckTokenUse);

describe('AppCheckSystem.outcomeOf — the outcome tag', () => {
  it.each(TRUTH_TABLE)('reads %o as %s', (input, outcome) => {
    expect(outcomeOf(input)).toBe(outcome);
  });

  it('covers all 8 fact combinations exactly once', () => {
    const keys = TRUTH_TABLE.map(([f]) => JSON.stringify(f));
    expect(new Set(keys).size).toBe(8);
  });
});

describe('AppCheckSystem.verdictOf — the full grid (3 modes × 8 facts × 2 uses)', () => {
  it('OFF never refuses and reports nothing (null)', () => {
    for (const [input] of TRUTH_TABLE) {
      for (const use of USES) {
        expect(verdictOf(AppCheckMode.Off, input, use)).toEqual({
          ok: true,
          value: null,
        });
      }
    }
  });

  it('MONITOR never refuses and reports the outcome', () => {
    for (const [input, outcome] of TRUTH_TABLE) {
      for (const use of USES) {
        expect(verdictOf(AppCheckMode.Monitor, input, use)).toEqual({
          ok: true,
          value: outcome,
        });
      }
    }
  });

  it('ENFORCE answers VALID on every callable', () => {
    for (const use of USES) {
      expect(
        verdictOf(AppCheckMode.Enforce, facts(true, true, false), use),
      ).toEqual({
        ok: true,
        value: AppCheckOutcome.Valid,
      });
    }
  });

  it('ENFORCE refuses MISSING and INVALID with APP_CHECK_REQUIRED naming the outcome, on every callable', () => {
    for (const [input, outcome] of TRUTH_TABLE) {
      if (
        outcome !== AppCheckOutcome.Missing &&
        outcome !== AppCheckOutcome.Invalid
      )
        continue;
      for (const use of USES) {
        expect(verdictOf(AppCheckMode.Enforce, input, use)).toEqual({
          ok: false,
          error: {
            errorCode: AppCheckErrorCode.Required,
            appCheckOutcome: outcome,
          },
        });
      }
    }
  });

  it('ENFORCE refuses REPLAYED only on a LIMITED_USE callable; a STANDARD one answers it', () => {
    const replayed = facts(true, true, true);
    expect(
      verdictOf(AppCheckMode.Enforce, replayed, AppCheckTokenUse.LimitedUse),
    ).toEqual({
      ok: false,
      error: {
        errorCode: AppCheckErrorCode.Replayed,
        appCheckOutcome: AppCheckOutcome.Replayed,
      },
    });
    expect(
      verdictOf(AppCheckMode.Enforce, replayed, AppCheckTokenUse.Standard),
    ).toEqual({ ok: true, value: AppCheckOutcome.Replayed });
  });

  it('a refusal always carries the outcome outcomeOf reads, and only ENFORCE refuses', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...MODES),
        fc.boolean(),
        fc.boolean(),
        fc.boolean(),
        fc.constantFrom(...USES),
        (mode, sent, verified, replayed, use) => {
          const input = facts(sent, verified, replayed);
          const verdict = verdictOf(mode, input, use);
          if (verdict.ok) {
            if (mode === AppCheckMode.Off) expect(verdict.value).toBeNull();
            else expect(verdict.value).toBe(outcomeOf(input));
          } else {
            expect(mode).toBe(AppCheckMode.Enforce);
            expect(verdict.error.appCheckOutcome).toBe(outcomeOf(input));
          }
        },
      ),
    );
  });
});

describe('purity', () => {
  it('is pure: same input → same output, inputs untouched', () => {
    for (const [raw] of TRUTH_TABLE) {
      const input = deepFreeze({ ...raw });
      for (const mode of MODES) {
        for (const use of USES) {
          const once = verdictOf(mode, input, use);
          const twice = verdictOf(mode, input, use);
          expect(twice).toEqual(once);
        }
      }
      expect(outcomeOf(input)).toBe(outcomeOf(input));
      expect(input).toEqual(raw);
    }
  });
});
