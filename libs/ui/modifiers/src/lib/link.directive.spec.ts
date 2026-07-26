import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { UiLinkDirective } from './link.directive';

@Component({
  imports: [UiLinkDirective],
  template: `<p>
    Agree to the
    <a uiLink href="/terms" data-testid="anchor">Terms</a> or
    <button type="button" uiLink data-testid="button">Edit</button>
  </p>`,
})
class HostComponent {}

describe('UiLinkDirective', () => {
  let fixture: ComponentFixture<HostComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HostComponent],
    }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
  });

  it('stamps data-link on anchors', () => {
    const anchor: HTMLElement = fixture.nativeElement.querySelector(
      '[data-testid="anchor"]',
    );
    expect(anchor.getAttribute('data-link')).toBe('');
  });

  it('stamps data-link on buttons — inline actions keep button semantics', () => {
    const button: HTMLButtonElement = fixture.nativeElement.querySelector(
      '[data-testid="button"]',
    );
    expect(button.getAttribute('data-link')).toBe('');
    expect(button.type).toBe('button');
  });
});
