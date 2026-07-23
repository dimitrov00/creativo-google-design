import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { UiRevealDirective } from './reveal.directive';

@Component({
  imports: [UiRevealDirective],
  template: `<section
    [uiReveal]="transition"
    [uiRevealTrigger]="trigger"
    [uiRevealDelay]="delay"
  >
    content
  </section>`,
})
class HostComponent {
  transition: 'fade-up' | 'fade' = 'fade-up';
  trigger: 'scroll' | 'mount' = 'mount';
  delay = 0;
}

describe('UiRevealDirective', () => {
  let fixture: ComponentFixture<HostComponent>;
  let animate: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    animate = vi.fn().mockReturnValue({} as Animation);
    HTMLElement.prototype.animate =
      animate as unknown as typeof HTMLElement.prototype.animate;
    await TestBed.configureTestingModule({
      imports: [HostComponent],
    }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
  });

  afterEach(() => {
    // jsdom ships no WAAPI — remove the stub rather than restoring one.
    delete (HTMLElement.prototype as { animate?: unknown }).animate;
    vi.restoreAllMocks();
  });

  function element(): HTMLElement {
    return fixture.nativeElement.querySelector('section');
  }

  it('writes data-reveal from the uiReveal input', async () => {
    fixture.componentInstance.transition = 'fade';
    fixture.detectChanges();
    await fixture.whenStable();
    expect(element().getAttribute('data-reveal')).toBe('fade');
  });

  it('plays the mount-trigger animation with token fallbacks and clears the start state', async () => {
    fixture.componentInstance.delay = 120;
    fixture.detectChanges();
    await fixture.whenStable();
    expect(animate).toHaveBeenCalledTimes(1);
    const [keyframes, options] = animate.mock.calls[0] as [
      Keyframe[],
      KeyframeAnimationOptions,
    ];
    expect(keyframes[0]).toMatchObject({
      opacity: 0,
      transform: 'translateY(24px)',
    });
    expect(keyframes[1]).toMatchObject({ opacity: 1 });
    // jsdom exposes no --sys-motion-* custom properties, so the directive
    // falls back to the values mirroring the token ladder.
    expect(options.duration).toBe(650);
    expect(options.delay).toBe(120);
    expect(options.fill).toBe('both');
    expect(element().hasAttribute('data-reveal-state')).toBe(false);
  });

  it('omits the rise transform for the plain fade transition', async () => {
    fixture.componentInstance.transition = 'fade';
    fixture.detectChanges();
    await fixture.whenStable();
    const [keyframes] = animate.mock.calls[0] as [Keyframe[]];
    expect(keyframes[0]?.['transform']).toBeUndefined();
  });

  it('no-ops (content stays visible) when the scroll trigger has no IntersectionObserver', async () => {
    fixture.componentInstance.trigger = 'scroll';
    fixture.detectChanges();
    await fixture.whenStable();
    expect(animate).not.toHaveBeenCalled();
    expect(element().hasAttribute('data-reveal-state')).toBe(false);
  });

  it('no-ops under prefers-reduced-motion', async () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn().mockReturnValue({ matches: true } as MediaQueryList),
    );
    fixture.detectChanges();
    await fixture.whenStable();
    expect(animate).not.toHaveBeenCalled();
    expect(element().hasAttribute('data-reveal-state')).toBe(false);
    vi.unstubAllGlobals();
  });
});
