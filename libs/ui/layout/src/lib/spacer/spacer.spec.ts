import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { UiSpacer } from './spacer';

@Component({
  imports: [UiSpacer],
  template: `<ui-spacer data-testid="spacer" />`,
})
class HostComponent {}

describe('UiSpacer', () => {
  let fixture: ComponentFixture<HostComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HostComponent],
    }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
  });

  it('writes the identity class and hides itself from assistive tech', () => {
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement.querySelector(
      '[data-testid="spacer"]',
    );
    expect(el.classList.contains('ui-spacer')).toBe(true);
    expect(el.getAttribute('aria-hidden')).toBe('true');
  });
});
