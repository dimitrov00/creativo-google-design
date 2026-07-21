import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { UiBadge } from './badge';
import type { UiBadgeTone } from './badge';

@Component({
  imports: [UiBadge],
  template: `<span uiBadge [uiTone]="tone()">New</span>`,
})
class HostComponent {
  readonly tone = signal<UiBadgeTone>('neutral');
}

describe('UiBadge', () => {
  let fixture: ComponentFixture<HostComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HostComponent],
    }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
  });

  it('defaults to the neutral tone as a data-* attribute', () => {
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement.querySelector('span');
    expect(el.classList.contains('ui-badge')).toBe(true);
    expect(el.getAttribute('data-tone')).toBe('neutral');
  });

  it('writes tone as a data-* attribute when changed', async () => {
    fixture.detectChanges();
    fixture.componentInstance.tone.set('destructive');
    fixture.detectChanges();
    await fixture.whenStable();
    const el: HTMLElement = fixture.nativeElement.querySelector('span');
    expect(el.getAttribute('data-tone')).toBe('destructive');
  });
});
