import { ElementRef, type Signal, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { elementWidth } from './element-width';

type ResizeCallback = (
  entries: readonly { contentRect: { width: number } }[],
) => void;

/** A ResizeObserver the spec drives by hand: who is observed, and what it reports. */
class FakeResizeObserver {
  static instances: FakeResizeObserver[] = [];
  readonly observed: Element[] = [];
  disconnected = false;

  constructor(readonly callback: ResizeCallback) {
    FakeResizeObserver.instances.push(this);
  }

  observe(target: Element): void {
    this.observed.push(target);
  }

  unobserve(target: Element): void {
    const at = this.observed.indexOf(target);
    if (at >= 0) this.observed.splice(at, 1);
  }

  disconnect(): void {
    this.disconnected = true;
  }

  report(width: number): void {
    this.callback([{ contentRect: { width } }]);
  }
}

function measure(
  element: Signal<ElementRef<Element> | undefined>,
): Signal<number> {
  TestBed.configureTestingModule({});
  return TestBed.runInInjectionContext(() => elementWidth(element));
}

afterEach(() => {
  vi.unstubAllGlobals();
  FakeResizeObserver.instances = [];
});

describe('elementWidth', () => {
  it('stays 0 where ResizeObserver is absent', () => {
    vi.stubGlobal('ResizeObserver', undefined);
    const width = measure(
      signal(new ElementRef(document.createElement('div'))),
    );
    TestBed.tick();
    expect(width()).toBe(0);
    expect(FakeResizeObserver.instances).toEqual([]);
  });

  it('observes the element the signal holds, and follows it when it changes', () => {
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
    const first = document.createElement('div');
    const second = document.createElement('div');
    const element = signal<ElementRef<Element> | undefined>(undefined);
    measure(element);
    TestBed.tick();
    const [observer] = FakeResizeObserver.instances;
    expect(observer?.observed).toEqual([]);

    element.set(new ElementRef(first));
    TestBed.tick();
    expect(observer?.observed).toEqual([first]);

    element.set(new ElementRef(second));
    TestBed.tick();
    expect(observer?.observed).toEqual([second]);
  });

  it('reports the last entry’s content width', () => {
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
    const width = measure(
      signal(new ElementRef(document.createElement('div'))),
    );
    TestBed.tick();
    const [observer] = FakeResizeObserver.instances;
    expect(width()).toBe(0);
    observer?.report(358);
    expect(width()).toBe(358);
    observer?.callback([
      { contentRect: { width: 100 } },
      { contentRect: { width: 320 } },
    ]);
    expect(width()).toBe(320);
  });

  it('disconnects when the injector is destroyed', () => {
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
    measure(signal(new ElementRef(document.createElement('div'))));
    TestBed.tick();
    const [observer] = FakeResizeObserver.instances;
    TestBed.resetTestingModule();
    expect(observer?.disconnected).toBe(true);
  });
});
