import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { UiNotice, type UiNoticeAnnounce, type UiNoticeTone } from './notice';

const css = readFileSync(resolve(__dirname, 'notice.css'), 'utf8');

@Component({
  imports: [UiNotice],
  template: `
    <ui-notice
      [uiTone]="tone()"
      [uiIcon]="icon()"
      [uiAnnounce]="announce()"
      uiLabel="Закачена бележка"
      data-testid="notice"
    >
      @if (titled()) {
        <h3 uiNoticeTitle tabindex="-1" [attr.id]="titleId()">
          Онлайн записването е спряно
        </h3>
      }
      <p>до 12.10 · 3 неявявания за 60 дни</p>
      @if (retry()) {
        <button uiNoticeActions type="button" (click)="retries = retries + 1">
          Опитай пак
        </button>
      }
    </ui-notice>
  `,
})
class Host {
  readonly tone = signal<UiNoticeTone>('warning');
  readonly icon = signal<'loyalty.freeze' | null>('loyalty.freeze');
  readonly announce = signal<UiNoticeAnnounce>('off');
  readonly titled = signal(true);
  readonly titleId = signal<string | null>(null);
  readonly retry = signal(false);
  retries = 0;
}

function render() {
  TestBed.configureTestingModule({
    imports: [Host],
    errorOnUnknownElements: true,
    errorOnUnknownProperties: true,
  });
  const fixture = TestBed.createComponent(Host);
  fixture.detectChanges();
  const notice = fixture.nativeElement.querySelector(
    '[data-testid="notice"]',
  ) as HTMLElement;
  const settle = () => {
    fixture.detectChanges();
    fixture.detectChanges();
  };
  settle();
  return { fixture, notice, settle };
}

describe('UiNotice', () => {
  it('is a standing note named by its title, the tone on its host', () => {
    const { notice } = render();
    expect(notice.classList.contains('ui-notice')).toBe(true);
    expect(notice.getAttribute('role')).toBe('note');
    expect(notice.dataset['tone']).toBe('warning');
    const title = notice.querySelector('[uiNoticeTitle]') as HTMLElement;
    expect(title.id).toMatch(/^ui-notice-title-\d+$/);
    expect(notice.getAttribute('aria-labelledby')).toBe(title.id);
    // The title names it; the fallback label would say it twice.
    expect(notice.getAttribute('aria-label')).toBeNull();
  });

  it('keeps a title id the consumer already gave', () => {
    const { fixture, notice, settle } = render();
    fixture.componentInstance.titled.set(false);
    settle();
    fixture.componentInstance.titleId.set('pause-title');
    fixture.componentInstance.titled.set(true);
    settle();
    expect(notice.getAttribute('aria-labelledby')).toBe('pause-title');
  });

  it('is named by its label when compact — no title — and re-points when a title arrives', () => {
    const { fixture, notice, settle } = render();
    fixture.componentInstance.titled.set(false);
    settle();
    expect(notice.getAttribute('aria-labelledby')).toBeNull();
    expect(notice.getAttribute('aria-label')).toBe('Закачена бележка');
    fixture.componentInstance.titled.set(true);
    settle();
    expect(notice.getAttribute('aria-labelledby')).toMatch(/^ui-notice-title-/);
    expect(notice.getAttribute('aria-label')).toBeNull();
  });

  it('speaks only when asked: a status politely, a refusal as an alert', () => {
    const { fixture, notice } = render();
    fixture.componentInstance.announce.set('polite');
    fixture.detectChanges();
    expect(notice.getAttribute('role')).toBe('status');
    fixture.componentInstance.announce.set('assertive');
    fixture.detectChanges();
    expect(notice.getAttribute('role')).toBe('alert');
  });

  it('leads with the tone glyph as decoration, and draws none without one', () => {
    const { fixture, notice } = render();
    const glyph = notice.querySelector('ui-icon.ui-notice__glyph');
    expect(glyph?.getAttribute('data-name')).toBe('loyalty.freeze');
    expect(glyph?.getAttribute('aria-hidden')).toBe('true');
    fixture.componentInstance.icon.set(null);
    fixture.detectChanges();
    expect(notice.querySelector('.ui-notice__glyph')).toBeNull();
  });

  it('projects the title, the facts and the actions into their places', () => {
    const { fixture, notice } = render();
    fixture.componentInstance.retry.set(true);
    fixture.detectChanges();
    const content = notice.querySelector('.ui-notice__content') as HTMLElement;
    expect(content.firstElementChild?.hasAttribute('uiNoticeTitle')).toBe(true);
    expect(
      notice.querySelector('.ui-notice__facts > p')?.textContent?.trim(),
    ).toBe('до 12.10 · 3 неявявания за 60 дни');
    const retry = notice.querySelector(
      '.ui-notice__actions > button',
    ) as HTMLButtonElement;
    retry.click();
    expect(fixture.componentInstance.retries).toBe(1);
  });

  it('stamps every tone', () => {
    const { fixture, notice } = render();
    for (const tone of [
      'neutral',
      'accent',
      'warning',
      'destructive',
    ] as const) {
      fixture.componentInstance.tone.set(tone);
      fixture.detectChanges();
      expect(notice.dataset['tone']).toBe(tone);
    }
  });

  it('washes a tone at the one tint over the segment fill, and keeps title and facts in the foreground ink', () => {
    expect(css).toMatch(
      /color-mix\(\s*in srgb,\s*var\(--ui-notice-tone\) var\(--sys-alpha-tint\),\s*var\(--sys-color-surface-secondary\)\s*\)/,
    );
    const title = /\[uiNoticeTitle\]\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(title).toContain('color: var(--sys-color-foreground)');
    const facts = /\.ui-notice__facts\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(facts).toContain('color: var(--sys-color-foreground)');
  });
});
