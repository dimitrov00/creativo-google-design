import type { CallableName, CallableWire } from '@core/ports';

/**
 * THE WIRE ANSWER, BY CALLABLE — types only. A pipeline answers its call
 * component's answer itself (Law 5: the struct, the wire JSON and the
 * document share one flat layout), so the composition root wires it AS IT
 * IS: no encoder copies it field by field. A pipeline that keeps
 * server-only fields (`replayed`, `revision`) or words one answer two ways
 * is projected by name (`committedOf`, `arrivedOf`, …) inside the handler,
 * and the projection's answer is held to the same rule.
 *
 * {@link AnswerIsTheWire} makes that rule the compiler's: `wiredCallable`
 * types its spec as `CallableSpec<N> & AnswerIsTheWire<A, N>` — nothing
 * more when the handler's answer is exactly callable `N`'s wire answer (no
 * field more: a server-only field would leak; none less: the web's decoder
 * would refuse it), and a field no spec can hold otherwise, so the call
 * does not compile.
 */

/** What callable `N` answers on the wire — its call component's answer. */
export type WireAnswer<N extends CallableName> = CallableWire[N]['answer'];

/** Mutual assignability: no field more (a leak), none less. */
export type SameShape<A, W> = [A] extends [W]
  ? [W] extends [A]
    ? true
    : false
  : false;

/**
 * Nothing more (`unknown`) when a handler's answer `A` IS callable `N`'s
 * wire answer; else a field no spec holds — the call does not compile.
 */
export type AnswerIsTheWire<A, N extends CallableName> =
  SameShape<A, WireAnswer<N>> extends true
    ? unknown
    : { readonly answerIsNotTheWireAnswer: never };
