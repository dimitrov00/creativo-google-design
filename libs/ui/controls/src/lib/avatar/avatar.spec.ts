import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { UiIconName } from '../icon/icon-registry';
import { UiAvatar } from './avatar';

@Component({
  imports: [UiAvatar],
  template: `<ui-avatar
    [uiSrc]="src()"
    [uiName]="name()"
    [uiIcon]="icon()"
    [uiControlSize]="'large'"
  />`,
})
class HostComponent {
  readonly src = signal<string | null>(null);
  readonly name = signal('Ada Lovelace');
  readonly icon = signal<UiIconName | null>(null);
}

describe('UiAvatar', () => {
  let fixture: ComponentFixture<HostComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HostComponent],
    }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
  });

  it('writes size as a data-* attribute', () => {
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement.querySelector('ui-avatar');
    expect(el.classList.contains('ui-avatar')).toBe(true);
    expect(el.getAttribute('data-control-size')).toBe('large');
  });

  it('renders the uppercased two-word monogram when there is no src', () => {
    // Apple-monogram grammar: first letters of the first two words.
    fixture.detectChanges();
    const fallback: HTMLElement = fixture.nativeElement.querySelector(
      '.ui-avatar__fallback',
    );
    expect(fallback.textContent?.trim()).toBe('AL');
  });

  it('renders the AsyncImage img when a src is provided', async () => {
    fixture.detectChanges();
    fixture.componentInstance.src.set('https://example.com/a.png');
    fixture.detectChanges();
    await fixture.whenStable();
    const img: HTMLImageElement | null = fixture.nativeElement.querySelector(
      '.ui-avatar .ui-async-image__image',
    );
    expect(img).not.toBeNull();
    expect(img?.getAttribute('alt')).toBe('Ada Lovelace');
    // AsyncImage parity: the monogram stays in the DOM as the placeholder —
    // it cross-fades out once the image loads and persists on error.
    expect(
      fixture.nativeElement.querySelector('.ui-avatar__fallback'),
    ).not.toBeNull();
  });

  /* A disc that stands for something other than a person — "anyone", a team,
     an unassigned lane. It replaces the monogram rather than joining it: the
     glyph IS the identity here, so a name alongside it would be two answers
     to the same question. */
  it('renders a glyph in place of the monogram when uiIcon is set', () => {
    fixture.componentInstance.icon.set('booking.anyBarber');
    fixture.detectChanges();
    const fallback: HTMLElement = fixture.nativeElement.querySelector(
      '.ui-avatar__fallback',
    );
    expect(fallback.querySelector('.ui-icon')).not.toBeNull();
    expect(fallback.textContent?.trim()).not.toBe('AL');
  });

  // It is a PLACEHOLDER like the monogram, so real bytes still win.
  it('keeps the glyph behind a real src', async () => {
    fixture.componentInstance.icon.set('booking.anyBarber');
    fixture.componentInstance.src.set('https://example.com/a.png');
    fixture.detectChanges();
    await fixture.whenStable();
    expect(
      fixture.nativeElement.querySelector('.ui-async-image__image'),
    ).not.toBeNull();
  });
});
