import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { CursorService } from './cursor.service';
import { CursorTargetDirective } from './cursor-target.directive';

@Component({
  imports: [CursorTargetDirective],
  template: `<button
    crCursorTarget
    crCursorTargetLabel="View"
    crCursorTargetStyle="fill"
  >
    Book now
  </button>`,
})
class Host {}

describe('CursorTargetDirective', () => {
  let isEnabled: ReturnType<typeof signal<boolean>>;

  beforeEach(() => {
    isEnabled = signal(true);
    TestBed.configureTestingModule({
      imports: [Host],
      providers: [
        {
          provide: CursorService,
          useValue: { isEnabled, activeTarget: signal(null) },
        },
      ],
    });
  });

  it('registers itself as the active cursor target on pointerenter, with its label/style', () => {
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    const button: HTMLButtonElement =
      fixture.nativeElement.querySelector('button');
    const cursorService = TestBed.inject(CursorService);

    button.dispatchEvent(new Event('pointerenter'));
    fixture.detectChanges();

    expect(cursorService.activeTarget()).toEqual({
      element: button,
      label: 'View',
      style: 'fill',
    });
    expect(button.hasAttribute('data-cr-cursor-hover')).toBe(true);
  });

  it('clears the active target on pointerleave', () => {
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    const button: HTMLButtonElement =
      fixture.nativeElement.querySelector('button');

    button.dispatchEvent(new Event('pointerenter'));
    fixture.detectChanges();
    button.dispatchEvent(new Event('pointerleave'));
    fixture.detectChanges();

    const cursorService = TestBed.inject(CursorService);
    expect(cursorService.activeTarget()).toBeNull();
    expect(button.hasAttribute('data-cr-cursor-hover')).toBe(false);
  });

  it('does nothing when the cursor system is disabled (reduced motion / coarse pointer)', () => {
    isEnabled.set(false);
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    const button: HTMLButtonElement =
      fixture.nativeElement.querySelector('button');

    button.dispatchEvent(new Event('pointerenter'));
    fixture.detectChanges();

    const cursorService = TestBed.inject(CursorService);
    expect(cursorService.activeTarget()).toBeNull();
    expect(button.hasAttribute('data-cr-cursor-hover')).toBe(false);
  });
});
