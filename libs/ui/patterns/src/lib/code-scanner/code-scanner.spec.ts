import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CODE_SCANNER_DETECTOR,
  CODE_SCANNER_MEDIA,
  UiCodeScanner,
  type CodeDetection,
  type CodeScannerState,
} from './code-scanner';

@Component({
  imports: [UiCodeScanner],
  template: `
    <ui-code-scanner
      [uiInterval]="50"
      uiStarting="Пускам камерата…"
      uiScanning="Търся код…"
      uiDenied="Няма достъп до камерата."
      uiUnsupported="Това устройство не сканира."
      (uiDetected)="codes.push($event)"
      (uiStateChange)="states.push($event)"
    />
  `,
})
class Host {
  codes: string[] = [];
  states: CodeScannerState[] = [];
}

type Media = () => Promise<MediaStream>;
type Detector =
  | ((formats: readonly string[]) => {
      detect: () => Promise<readonly CodeDetection[]>;
    })
  | null;

/** Lets the scanner's own awaits settle without a real clock. */
async function settle(fixture: { detectChanges: () => void }) {
  for (let i = 0; i < 6; i += 1) await Promise.resolve();
  fixture.detectChanges();
}

async function render(media: Media, detector: Detector) {
  await TestBed.configureTestingModule({
    imports: [Host],
    providers: [
      { provide: CODE_SCANNER_MEDIA, useValue: media },
      { provide: CODE_SCANNER_DETECTOR, useValue: detector },
    ],
  }).compileComponents();
  const fixture = TestBed.createComponent(Host);
  fixture.detectChanges();
  const host = fixture.nativeElement as HTMLElement;
  const status = () =>
    host.querySelector('.ui-code-scanner__status')?.textContent?.trim();
  const state = () =>
    host.querySelector('.ui-code-scanner')?.getAttribute('data-state');
  return { fixture, host, status, state };
}

const fakeStream = () => {
  const stops: number[] = [];
  const stream = {
    getTracks: () => [{ stop: () => stops.push(1) }],
  } as unknown as MediaStream;
  return { stream, stops };
};

describe('UiCodeScanner', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('says the device cannot scan when the engine has no detector, and asks for no camera', async () => {
    let asked = 0;
    const { fixture, status, state } = await render(async () => {
      asked += 1;
      return fakeStream().stream;
    }, null);
    await settle(fixture);
    expect(state()).toBe('unsupported');
    expect(status()).toBe('Това устройство не сканира.');
    expect(asked).toBe(0);
    expect(fixture.componentInstance.states).toEqual(['unsupported']);
  });

  it('says why when the camera is refused', async () => {
    const { fixture, status, state } = await render(
      async () => {
        throw new Error('NotAllowedError');
      },
      () => ({ detect: async () => [] }),
    );
    await settle(fixture);
    expect(state()).toBe('denied');
    expect(status()).toBe('Няма достъп до камерата.');
  });

  it('reads the first code the camera shows, once, and lets the camera go', async () => {
    const { stream, stops } = fakeStream();
    let reads = 0;
    const { fixture, state } = await render(
      async () => stream,
      () => ({
        detect: async () => {
          reads += 1;
          return reads < 2
            ? []
            : [{ rawValue: ' gift2025 ' }, { rawValue: 'X' }];
        },
      }),
    );
    await settle(fixture);
    expect(state()).toBe('scanning');
    // The first frame shows nothing; the second shows the code.
    await vi.advanceTimersByTimeAsync(50);
    expect(fixture.componentInstance.codes).toEqual([]);
    await vi.advanceTimersByTimeAsync(50);
    fixture.detectChanges();
    expect(fixture.componentInstance.codes).toEqual(['gift2025']);
    expect(state()).toBe('done');
    expect(stops).toEqual([1]);
    // Nothing more is read once it is done.
    await vi.advanceTimersByTimeAsync(200);
    expect(reads).toBe(2);
    expect(fixture.componentInstance.codes).toEqual(['gift2025']);
  });
});
