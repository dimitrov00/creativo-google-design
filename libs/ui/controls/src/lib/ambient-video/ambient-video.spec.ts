import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { UiAmbientVideo } from './ambient-video';

@Component({
  imports: [UiAmbientVideo],
  template: `<ui-ambient-video
    [uiSrc]="'/hero.mp4'"
    [uiPoster]="'/work/landing-poster.jpg'"
    [uiLabel]="label()"
  />`,
})
class HostComponent {
  readonly label = signal<string | undefined>(undefined);
}

describe('UiAmbientVideo', () => {
  let fixture: ComponentFixture<HostComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HostComponent],
    }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
  });

  const host = (): HTMLElement =>
    fixture.nativeElement.querySelector('ui-ambient-video');

  it('renders the poster under a muted looping inline video', () => {
    fixture.detectChanges();
    const el = host();
    expect(el.classList.contains('ui-ambient-video')).toBe(true);
    expect(el.getAttribute('data-state')).toBe('idle');
    const poster = el.querySelector<HTMLImageElement>(
      '.ui-ambient-video__poster',
    );
    expect(poster?.getAttribute('src')).toBe('/work/landing-poster.jpg');
    expect(poster?.getAttribute('alt')).toBe('');
    const video = el.querySelector<HTMLVideoElement>(
      '.ui-ambient-video__video',
    );
    expect(video?.getAttribute('src')).toBe('/hero.mp4');
    expect(video?.hasAttribute('muted')).toBe(true);
    expect(video?.hasAttribute('loop')).toBe(true);
    expect(video?.hasAttribute('playsinline')).toBe(true);
  });

  it('stamps data-state="loaded" once the first frame is decodable', () => {
    fixture.detectChanges();
    host()
      .querySelector('.ui-ambient-video__video')
      ?.dispatchEvent(new Event('loadeddata'));
    fixture.detectChanges();
    expect(host().getAttribute('data-state')).toBe('loaded');
  });

  it('is decorative by default, a labelled img when uiLabel is set', async () => {
    fixture.detectChanges();
    expect(host().getAttribute('aria-hidden')).toBe('true');
    expect(host().getAttribute('role')).toBeNull();

    fixture.componentInstance.label.set('Studio ambience');
    fixture.detectChanges();
    await fixture.whenStable();
    expect(host().getAttribute('aria-hidden')).toBeNull();
    expect(host().getAttribute('role')).toBe('img');
    expect(host().getAttribute('aria-label')).toBe('Studio ambience');
  });
});
