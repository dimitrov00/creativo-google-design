/**
 * The loyalty pass's state tag (client-card-revision-3 §2.2.1), the ONLY
 * source of its strings and named after the field it types (Law 1, Law
 * 6.2): `passState: PassState` — the one thing the state line under the
 * figure says (what the figure counts is `PassFigure`,
 * `pass-figure.data.ts`). `LoyaltyPassSystem.passOf` decides it; the
 * presenter words it. A plain tag an answer carries, nothing to compute on
 * beyond `===`, so no companion members.
 *
 * What the pass's state line says, first match wins: a paused client's pass
 * is `FROZEN`; with points off, or nothing to say, it is `CLEAR` (no line);
 * an account that owes `OWES`; points inside their notice window `EXPIRING`.
 */
export const PassState = {
  Frozen: 'FROZEN',
  Owes: 'OWES',
  Expiring: 'EXPIRING',
  Clear: 'CLEAR',
} as const;
export type PassState = (typeof PassState)[keyof typeof PassState];
