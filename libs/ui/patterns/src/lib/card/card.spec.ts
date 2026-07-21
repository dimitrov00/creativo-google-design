import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { UiCard } from './card';

@Component({
  imports: [UiCard],
  template: `<ui-card
    [uiPadding]="'loose'"
    [uiTone]="tone()"
    [uiInteractive]="interactive()"
    data-testid="card"
    >content</ui-card
  >`,
})
class HostComponent {
  tone = signal<'plain' | 'accent' | 'muted'>('accent');
  interactive = signal(false);
}

describe('UiCard', () => {
  let fixture: ComponentFixture<HostComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HostComponent],
    }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
  });

  it('writes padding/tone as data-* attributes, never as classes', () => {
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement.querySelector(
      '[data-testid="card"]',
    );
    expect(el.classList.contains('ui-card')).toBe(true);
    expect(el.getAttribute('data-padding')).toBe('loose');
    expect(el.getAttribute('data-tone')).toBe('accent');
    expect(el.getAttribute('data-interactive')).toBeNull();
  });

  it('writes data-interactive as an empty-string attribute when uiInteractive is true', () => {
    fixture.componentInstance.interactive.set(true);
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement.querySelector(
      '[data-testid="card"]',
    );
    expect(el.getAttribute('data-interactive')).toBe('');
  });

  it('defaults uiPadding to "comfortable" and uiTone to "plain" when unbound', () => {
    fixture.componentInstance.tone.set('plain');
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement.querySelector(
      '[data-testid="card"]',
    );
    expect(el.getAttribute('data-tone')).toBe('plain');
  });
});
