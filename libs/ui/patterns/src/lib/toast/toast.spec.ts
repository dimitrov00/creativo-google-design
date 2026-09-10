import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { UiToast } from './toast';

@Component({
  imports: [UiToast],
  template: `
    <ui-toast
      [uiPresented]="presented()"
      uiLabel="Отбелязан като дошъл"
      uiActionLabel="Отмени"
      [uiDuration]="50"
      (uiAction)="acted = acted + 1"
      (uiDismissed)="dismissed = dismissed + 1"
    />
  `,
})
class Host {
  readonly presented = signal(false);
  acted = 0;
  dismissed = 0;
}

describe('UiToast', () => {
  let fixture: ComponentFixture<Host>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Host],
    }).compileComponents();
    fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
  });

  const surface = () =>
    fixture.nativeElement.querySelector('.ui-toast__surface') as HTMLElement;

  it('is a polite status region with the sentence and the one way back', () => {
    fixture.componentInstance.presented.set(true);
    fixture.detectChanges();

    expect(surface().getAttribute('role')).toBe('status');
    expect(surface().getAttribute('aria-live')).toBe('polite');
    expect(surface().textContent).toContain('Отбелязан като дошъл');
    expect(surface().querySelector('button')?.textContent?.trim()).toBe(
      'Отмени',
    );
  });

  it('emits the action once and stops its own clock', async () => {
    fixture.componentInstance.presented.set(true);
    fixture.detectChanges();
    surface().querySelector('button')?.click();
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(fixture.componentInstance.acted).toBe(1);
    expect(fixture.componentInstance.dismissed).toBe(0);
  });

  it('times out on its own, but not while someone is holding it', async () => {
    fixture.componentInstance.presented.set(true);
    fixture.detectChanges();
    surface().dispatchEvent(new Event('pointerenter'));
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(fixture.componentInstance.dismissed).toBe(0);
    surface().dispatchEvent(new Event('pointerleave'));
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(fixture.componentInstance.dismissed).toBe(1);
  });

  it('renders nothing at all when not presented', () => {
    expect(surface()).toBeNull();
  });
});
