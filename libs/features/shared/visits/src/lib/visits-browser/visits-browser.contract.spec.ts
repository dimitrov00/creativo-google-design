import {
  type InputSignal,
  type InputSignalWithTransform,
  type OutputEmitterRef,
  reflectComponentType,
} from '@angular/core';
import { describe, expect, expectTypeOf, it } from 'vitest';
import type { VisitListPaging, VisitListState } from '../visit-list/visit-list';
import type {
  VisitListStyle,
  VisitPerspective,
  VisitSectionVm,
} from '../visit-row.vm';
import { VisitsBrowser, type VisitsBrowserBleed } from './visits-browser';

/*
 * THE BROWSER'S PUBLIC API (revision 3 §3.11, §7.3) — what «Моите часове»
 * and the staff card's «Посещения» bind. It is a contract between
 * packages, so it is pinned apart from the drawing: by the component's own
 * metadata and its types, never by mounting it. The spec of the drawing
 * sits beside it (`visits-browser.spec.ts`); a change to a name below goes
 * through the lead.
 */

describe('lib-visits-browser, the public API', () => {
  const mirror = reflectComponentType(VisitsBrowser);

  it('is a standalone component with the selector both screens mount', () => {
    expect(mirror?.selector).toBe('lib-visits-browser');
    expect(mirror?.isStandalone).toBe(true);
  });

  it('takes the nine inputs of the contract, under their own names', () => {
    expect(
      mirror?.inputs.map((input) => [input.propName, input.templateName]),
    ).toEqual([
      ['sections', 'sections'],
      ['perspective', 'perspective'],
      ['listStyle', 'listStyle'],
      ['state', 'state'],
      ['paging', 'paging'],
      ['testIdPrefix', 'testIdPrefix'],
      ['pills', 'pills'],
      ['bleed', 'bleed'],
      ['interactive', 'interactive'],
    ]);
  });

  it('emits the list’s three events, the list’s own names', () => {
    expect(
      mirror?.outputs.map((output) => [output.propName, output.templateName]),
    ).toEqual([
      ['openRow', 'openRow'],
      ['loadMore', 'loadMore'],
      ['retry', 'retry'],
    ]);
  });

  it('types every input and output as the contract words it', () => {
    expectTypeOf<VisitsBrowser['sections']>().toEqualTypeOf<
      InputSignal<readonly VisitSectionVm[]>
    >();
    expectTypeOf<VisitsBrowser['perspective']>().toEqualTypeOf<
      InputSignal<VisitPerspective>
    >();
    expectTypeOf<VisitsBrowser['listStyle']>().toEqualTypeOf<
      InputSignal<VisitListStyle>
    >();
    expectTypeOf<VisitsBrowser['state']>().toEqualTypeOf<
      InputSignal<VisitListState>
    >();
    expectTypeOf<VisitsBrowser['paging']>().toEqualTypeOf<
      InputSignal<VisitListPaging | null>
    >();
    expectTypeOf<VisitsBrowser['testIdPrefix']>().toEqualTypeOf<
      InputSignal<string | null>
    >();
    expectTypeOf<VisitsBrowser['pills']>().toEqualTypeOf<
      InputSignalWithTransform<boolean, unknown>
    >();
    expectTypeOf<VisitsBrowserBleed>().toEqualTypeOf<
      'viewport' | 'container'
    >();
    expectTypeOf<VisitsBrowser['bleed']>().toEqualTypeOf<
      InputSignal<VisitsBrowserBleed>
    >();
    // `null` is the perspective's own: the client's rows are buttons, the
    // staff's static.
    expectTypeOf<VisitsBrowser['interactive']>().toEqualTypeOf<
      InputSignal<boolean | null>
    >();
    expectTypeOf<VisitsBrowser['openRow']>().toEqualTypeOf<
      OutputEmitterRef<string>
    >();
    expectTypeOf<VisitsBrowser['loadMore']>().toEqualTypeOf<
      OutputEmitterRef<void>
    >();
    expectTypeOf<VisitsBrowser['retry']>().toEqualTypeOf<
      OutputEmitterRef<void>
    >();
  });
});
