import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { UiListRow } from './list-row';

@Component({
  imports: [UiListRow],
  template: `
    <ui-list-row
      data-testid="row"
      [uiSize]="size()"
      [uiVariant]="variant()"
      [uiInteractive]="interactive()"
    >
      <span uiLeading>glyph</span>
      Label text
      <span uiTrailing>detail</span>
    </ui-list-row>
    <a uiListRow data-testid="anchor-row" href="#somewhere">Anchor label</a>
  `,
})
class HostComponent {
  size = signal<'regular' | 'prominent'>('prominent');
  variant = signal<'plain' | 'prominent'>('plain');
  interactive = signal(false);
}

describe('UiListRow', () => {
  let fixture: ComponentFixture<HostComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HostComponent],
    }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
  });

  it('stamps the host class and defaults to the prominent size, non-interactive', () => {
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement.querySelector(
      '[data-testid="row"]',
    );
    expect(el.classList.contains('ui-list-row')).toBe(true);
    expect(el.getAttribute('data-size')).toBe('prominent');
    expect(el.getAttribute('data-variant')).toBe('plain');
    expect(el.getAttribute('data-interactive')).toBeNull();
  });

  it('stamps the prominent variant as data-variant (DS button vocabulary)', () => {
    fixture.componentInstance.variant.set('prominent');
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement.querySelector(
      '[data-testid="row"]',
    );
    expect(el.getAttribute('data-variant')).toBe('prominent');
    expect(el.classList.contains('ui-list-row')).toBe(true);
    // Styling hangs off the attribute alone — never a variant class.
    expect(Array.from(el.classList).some((c) => c.includes('prominent'))).toBe(
      false,
    );
  });

  it('writes size/interactive as data-* attributes, never as classes', () => {
    fixture.componentInstance.size.set('regular');
    fixture.componentInstance.interactive.set(true);
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement.querySelector(
      '[data-testid="row"]',
    );
    expect(el.getAttribute('data-size')).toBe('regular');
    expect(el.getAttribute('data-interactive')).toBe('');
  });

  it('projects leading/trailing slots as siblings of the label wrapper', () => {
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement.querySelector(
      '[data-testid="row"]',
    );
    expect(el.querySelector('[uiLeading]')?.textContent).toBe('glyph');
    expect(el.querySelector('[uiTrailing]')?.textContent).toBe('detail');
    expect(el.querySelector('.ui-list-row__label')?.textContent?.trim()).toBe(
      'Label text',
    );
  });

  it('attaches to native anchors via the attribute selector form', () => {
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement.querySelector(
      '[data-testid="anchor-row"]',
    );
    expect(el.tagName).toBe('A');
    expect(el.classList.contains('ui-list-row')).toBe(true);
    expect(el.getAttribute('data-size')).toBe('prominent');
    expect(el.querySelector('.ui-list-row__label')?.textContent?.trim()).toBe(
      'Anchor label',
    );
  });
});
