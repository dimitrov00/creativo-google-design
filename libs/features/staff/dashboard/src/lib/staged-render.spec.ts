import { Component, Injector, inject, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { climbStages } from './staged-render';

const LAST = 3;

@Component({
  selector: 'lib-staged-host',
  template: `<p data-testid="stage">{{ stage() }}</p>`,
})
class StagedHost {
  readonly stage = signal(0);

  constructor() {
    climbStages(this.stage, LAST, inject(Injector));
  }
}

const nextFrame = () =>
  new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

describe('climbStages', () => {
  // An error thrown inside a frame callback reaches the window, not the
  // test: record it here (and keep it from the runner) so a case can
  // assert there was none.
  let errors: unknown[] = [];
  const onError = (event: ErrorEvent): void => {
    errors.push(event.error);
    event.preventDefault();
  };

  beforeEach(async () => {
    errors = [];
    window.addEventListener('error', onError);
    await TestBed.configureTestingModule({
      imports: [StagedHost],
    }).compileComponents();
  });

  afterEach(() => {
    window.removeEventListener('error', onError);
  });

  it('raises the stage by one two frames after each step is drawn, up to the last, and no further', async () => {
    const fixture = TestBed.createComponent(StagedHost);
    fixture.detectChanges();
    const twoFrames = async () => {
      await nextFrame();
      await nextFrame();
      await fixture.whenStable();
      fixture.detectChanges();
    };
    expect(fixture.componentInstance.stage()).toBe(0);
    await twoFrames();
    expect(fixture.componentInstance.stage()).toBe(1);
    await twoFrames();
    expect(fixture.componentInstance.stage()).toBe(2);
    await twoFrames();
    expect(fixture.componentInstance.stage()).toBe(LAST);
    await twoFrames();
    expect(fixture.componentInstance.stage()).toBe(LAST);
    expect(errors).toEqual([]);
  });

  it('stops when the sheet is closed between a step’s two frames, and throws nothing', async () => {
    const fixture = TestBed.createComponent(StagedHost);
    fixture.detectChanges();
    await fixture.whenStable();
    const { stage } = fixture.componentInstance;
    // One frame on: the step's first frame has run, its second is queued.
    await nextFrame();
    expect(stage()).toBe(0);
    fixture.destroy();
    await nextFrame();
    await nextFrame();
    await nextFrame();
    expect(errors).toEqual([]);
    expect(stage()).toBe(0);
  });

  it('stops when the test module is torn down between a step’s two frames, and throws nothing', async () => {
    const fixture = TestBed.createComponent(StagedHost);
    fixture.detectChanges();
    await fixture.whenStable();
    const { stage } = fixture.componentInstance;
    await nextFrame();
    expect(stage()).toBe(0);
    TestBed.resetTestingModule();
    await nextFrame();
    await nextFrame();
    await nextFrame();
    expect(errors).toEqual([]);
    expect(stage()).toBe(0);
  });
});
