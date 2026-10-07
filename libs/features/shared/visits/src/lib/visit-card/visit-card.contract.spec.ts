import {
  type InputSignal,
  type InputSignalWithTransform,
  type OutputEmitterRef,
  reflectComponentType,
} from '@angular/core';
import type { UiCardPadding, UiCardTone } from '@creativo/ui/controls';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { VisitCard, type VisitCardHeaderProminence } from './visit-card';
import type { VisitCardVm } from './visit-card.vm';

/*
 * THE CARD'S PUBLIC API (revision 3 §3.10, §7.3) — what `/account` and the
 * staff glance bind. It is a contract between packages, so it is pinned
 * apart from the drawing: by the component's own metadata and its types,
 * never by mounting it. The spec of the drawing sits beside it
 * (`visit-card.spec.ts`); a change to a name below goes through the lead.
 */

describe('lib-visit-card, the public API', () => {
  const mirror = reflectComponentType(VisitCard);

  it('is a standalone component with the selector both hosts mount', () => {
    expect(mirror?.selector).toBe('lib-visit-card');
    expect(mirror?.isStandalone).toBe(true);
  });

  it('takes the six inputs of the contract, under their own names', () => {
    expect(
      mirror?.inputs.map((input) => [input.propName, input.templateName]),
    ).toEqual([
      ['vm', 'vm'],
      ['headerProminence', 'headerProminence'],
      ['tone', 'tone'],
      ['padding', 'padding'],
      ['interactive', 'interactive'],
      ['showServices', 'showServices'],
    ]);
  });

  it('emits a tap on the card and a tap on a thumb', () => {
    expect(
      mirror?.outputs.map((output) => [output.propName, output.templateName]),
    ).toEqual([
      ['open', 'open'],
      ['openPhoto', 'openPhoto'],
    ]);
  });

  it('types every input and output as the contract words it', () => {
    expectTypeOf<VisitCard['vm']>().toEqualTypeOf<InputSignal<VisitCardVm>>();
    expectTypeOf<VisitCardHeaderProminence>().toEqualTypeOf<
      'standard' | 'increased'
    >();
    expectTypeOf<VisitCard['headerProminence']>().toEqualTypeOf<
      InputSignal<VisitCardHeaderProminence>
    >();
    expectTypeOf<VisitCard['tone']>().toEqualTypeOf<InputSignal<UiCardTone>>();
    expectTypeOf<VisitCard['padding']>().toEqualTypeOf<
      InputSignal<UiCardPadding>
    >();
    // A bare attribute switches it on: `<lib-visit-card interactive />`.
    expectTypeOf<VisitCard['interactive']>().toEqualTypeOf<
      InputSignalWithTransform<boolean, unknown>
    >();
    expectTypeOf<VisitCard['showServices']>().toEqualTypeOf<
      InputSignalWithTransform<boolean, unknown>
    >();
    expectTypeOf<VisitCard['open']>().toEqualTypeOf<OutputEmitterRef<void>>();
    expectTypeOf<VisitCard['openPhoto']>().toEqualTypeOf<
      OutputEmitterRef<string>
    >();
  });
});
