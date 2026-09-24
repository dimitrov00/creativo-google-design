import { Component, viewChild } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CAMERA_MEDIA } from './camera-media';
import { UiCameraCapture, type CameraCaptureState } from './camera-capture';

@Component({
  imports: [UiCameraCapture],
  template: `
    <ui-camera-capture
      #camera
      [uiRatio]="3 / 4"
      uiStarting="Камерата се включва…"
      uiReady="Насочи и снимай."
      uiDenied="Няма достъп до камерата."
      uiUnsupported="Тук няма камера."
      (uiCaptured)="pictures.push($event)"
      (uiStateChange)="states.push($event)"
    />
  `,
})
class Host {
  readonly camera = viewChild.required<UiCameraCapture>('camera');
  pictures: Blob[] = [];
  states: CameraCaptureState[] = [];
}

/** Lets the control's own awaits settle without a real clock. */
async function settle(fixture: { detectChanges: () => void }) {
  for (let i = 0; i < 6; i += 1) await Promise.resolve();
  fixture.detectChanges();
}

async function render(media: () => Promise<MediaStream>) {
  await TestBed.configureTestingModule({
    imports: [Host],
    providers: [{ provide: CAMERA_MEDIA, useValue: media }],
  }).compileComponents();
  const fixture = TestBed.createComponent(Host);
  fixture.detectChanges();
  const host = fixture.nativeElement as HTMLElement;
  const status = () =>
    host.querySelector('.ui-camera-capture__status')?.textContent?.trim();
  const state = () =>
    host.querySelector('.ui-camera-capture')?.getAttribute('data-state');
  return { fixture, host, status, state };
}

const fakeStream = () => {
  const stops: number[] = [];
  const stream = {
    getTracks: () => [{ stop: () => stops.push(1) }],
  } as unknown as MediaStream;
  return { stream, stops };
};

describe('UiCameraCapture', () => {
  afterEach(() => vi.restoreAllMocks());

  it('asks for the camera when the view is up, says it is ready, and shows the picture in its own shape', async () => {
    const { stream } = fakeStream();
    let asked = 0;
    const { fixture, host, status, state } = await render(async () => {
      asked += 1;
      return stream;
    });
    expect(state()).toBe('starting');
    expect(status()).toBe('Камерата се включва…');
    await settle(fixture);
    expect(asked).toBe(1);
    expect(state()).toBe('ready');
    expect(status()).toBe('Насочи и снимай.');
    expect(fixture.componentInstance.states).toEqual(['ready']);
    expect(
      host
        .querySelector<HTMLElement>('.ui-camera-capture')
        ?.style.getPropertyValue('--ui-camera-capture-ratio'),
    ).toBe('0.75');
    expect(host.querySelector('video')?.hasAttribute('playsinline')).toBe(true);
  });

  it('says no when the person refuses, and that there is no camera when the engine has none', async () => {
    const refused = await render(async () => {
      throw Object.assign(new Error('no'), { name: 'NotAllowedError' });
    });
    await settle(refused.fixture);
    expect(refused.state()).toBe('denied');
    expect(refused.status()).toBe('Няма достъп до камерата.');

    TestBed.resetTestingModule();
    const bare = await render(async () => {
      throw new TypeError(
        "Cannot read properties of undefined (reading 'getUserMedia')",
      );
    });
    await settle(bare.fixture);
    expect(bare.state()).toBe('unsupported');
    expect(bare.status()).toBe('Тук няма камера.');
  });

  it('takes the frame the viewfinder shows — the 3:4 box centred in a wide frame — as a JPEG, once, and lets the camera go', async () => {
    const { stream, stops } = fakeStream();
    const { fixture, host } = await render(async () => stream);
    await settle(fixture);
    const video = host.querySelector('video') as HTMLVideoElement;
    Object.defineProperty(video, 'videoWidth', {
      value: 1280,
      configurable: true,
    });
    Object.defineProperty(video, 'videoHeight', {
      value: 720,
      configurable: true,
    });
    const drawn: unknown[][] = [];
    const sizes: { width: number; height: number }[] = [];
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
      function (this: HTMLCanvasElement) {
        sizes.push({ width: this.width, height: this.height });
        return {
          drawImage: (...args: unknown[]) => drawn.push(args),
        } as unknown as CanvasRenderingContext2D;
      },
    );
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(
      function (callback, type) {
        callback(new Blob(['jpeg'], { type: String(type) }));
      },
    );

    expect(await fixture.componentInstance.camera().shoot()).toBe(true);
    await settle(fixture);
    // A 1280×720 frame holds a 540×720 box of 3:4, 370 px in from the left.
    expect(sizes).toEqual([{ width: 540, height: 720 }]);
    expect(drawn[0]?.slice(1)).toEqual([370, 0, 540, 720, 0, 0, 540, 720]);
    expect(fixture.componentInstance.pictures.map((p) => p.type)).toEqual([
      'image/jpeg',
    ]);
    expect(fixture.componentInstance.states).toEqual(['ready', 'done']);
    expect(stops).toEqual([1]);
    // Said once: a second press takes nothing.
    expect(await fixture.componentInstance.camera().shoot()).toBe(false);
    expect(fixture.componentInstance.pictures.length).toBe(1);
  });

  it('takes nothing before the camera is up, and releases the camera when the view goes', async () => {
    const { stream, stops } = fakeStream();
    let resolve: (value: MediaStream) => void = () => undefined;
    const { fixture } = await render(
      () => new Promise<MediaStream>((r) => (resolve = r)),
    );
    expect(await fixture.componentInstance.camera().shoot()).toBe(false);
    fixture.destroy();
    resolve(stream);
    await settle({ detectChanges: () => undefined });
    // The stream that arrived after the view went is let go at once.
    expect(stops).toEqual([1]);
  });
});
