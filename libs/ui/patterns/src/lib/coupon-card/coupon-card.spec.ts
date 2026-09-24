import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { UiInteractiveDirective } from '@creativo/ui/modifiers';
import { UiCouponCard } from './coupon-card';

@Component({
  imports: [UiCouponCard, UiInteractiveDirective],
  template: `
    <button
      uiCouponCard
      uiInteractive
      uiTitle="Първо посещение"
      uiValue="−2,80 €"
      [uiCode]="code()"
      [uiDetail]="detail()"
      [uiAction]="action()"
      [uiUnavailable]="blocked()"
      data-testid="card"
      (click)="taps = taps + 1"
    >
      <span uiCouponGlyph data-testid="glyph">✦</span>
      @if (blocked()) {
        <span uiCouponBadge data-testid="badge">⊘</span>
      }
    </button>
  `,
})
class Host {
  readonly code = signal<string | null>('FIRST10');
  readonly detail = signal<string | null>('−10% · комбинира се');
  readonly action = signal<string | null>('Използвай');
  readonly blocked = signal(false);
  taps = 0;
}

async function render() {
  await TestBed.configureTestingModule({ imports: [Host] }).compileComponents();
  const fixture = TestBed.createComponent(Host);
  fixture.detectChanges();
  const host = fixture.nativeElement as HTMLElement;
  const card = host.querySelector<HTMLButtonElement>('[data-testid="card"]');
  if (!card) throw new Error('no card');
  const text = (sel: string) => card.querySelector(sel)?.textContent?.trim();
  return { fixture, card, text };
}

describe('UiCouponCard', () => {
  it('is one button: the name over the value with its code, the conditions in a chip against the call, the glyph the host gave', async () => {
    const { fixture, card, text } = await render();
    expect(card.tagName).toBe('BUTTON');
    expect(card.classList.contains('ui-coupon-card')).toBe(true);
    // The one sanctioned hover/press grammar rides along.
    expect(card.hasAttribute('data-interactive')).toBe(true);
    expect(text('.ui-coupon-card__title')).toBe('Първо посещение');
    expect(text('.ui-coupon-card__value')).toBe('−2,80 €');
    expect(text('.ui-coupon-card__code')).toBe('FIRST10');
    expect(text('.ui-coupon-card__detail')).toBe('−10% · комбинира се');
    expect(text('.ui-coupon-card__action')).toBe('Използвай');
    expect(
      card.querySelector('.ui-coupon-card__glyph [data-testid="glyph"]'),
    ).not.toBeNull();
    // Decoration to a reader: the button's text is the offer.
    expect(
      card.querySelector('.ui-coupon-card__glyph')?.getAttribute('aria-hidden'),
    ).toBe('true');
    card.click();
    expect(fixture.componentInstance.taps).toBe(1);
  });

  it('drops the code, the conditions and the call when there are none, keeping the tear where it is', async () => {
    const { fixture, card } = await render();
    fixture.componentInstance.code.set(null);
    fixture.componentInstance.detail.set(null);
    fixture.componentInstance.action.set(null);
    fixture.detectChanges();
    expect(card.querySelector('.ui-coupon-card__code')).toBeNull();
    expect(card.querySelector('.ui-coupon-card__action')).toBeNull();
    // The foot stays, empty, so the notches never move.
    expect(card.querySelector('.ui-coupon-card__foot')).not.toBeNull();
    expect(card.querySelector('.ui-coupon-card__detail--none')).not.toBeNull();
  });

  it('is muted and inert when it cannot be used, the reason in the badge slot the check takes when applied', async () => {
    const { fixture, card } = await render();
    expect(card.hasAttribute('data-unavailable')).toBe(false);
    expect(card.disabled).toBe(false);
    fixture.componentInstance.blocked.set(true);
    fixture.componentInstance.action.set('Не се комбинира');
    fixture.detectChanges();
    // One slot, three states: the host's glyph lands where the check would.
    expect(card.hasAttribute('data-unavailable')).toBe(true);
    expect(card.disabled).toBe(true);
    expect(
      card.querySelector('.ui-coupon-card__badge [data-testid="badge"]'),
    ).not.toBeNull();
    expect(
      card.querySelector('.ui-coupon-card__action')?.textContent?.trim(),
    ).toBe('Не се комбинира');
    card.click();
    expect(fixture.componentInstance.taps).toBe(0);
  });
});

@Component({
  imports: [UiCouponCard],
  template: `
    <article
      uiCouponCard
      [uiApplied]="true"
      uiTitle="Брада −5 €"
      uiValue="−5,00 €"
      uiCode="BEARD5"
      uiDetail="комбинира се"
      uiTestId="line"
      data-testid="ticket"
    >
      <span uiCouponGlyph>✦</span>
      <span uiCouponBadge data-testid="badge">✓</span>
      <button
        type="button"
        uiCouponAction
        data-testid="remove"
        (click)="removed = removed + 1"
      >
        Премахни
      </button>
    </article>
  `,
})
class AppliedHost {
  removed = 0;
}

describe('UiCouponCard on the bill', () => {
  it('is an article, not a button — no type, no press grammar — stamped and with a real action where the call stood', async () => {
    await TestBed.configureTestingModule({
      imports: [AppliedHost],
    }).compileComponents();
    const fixture = TestBed.createComponent(AppliedHost);
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    const ticket = host.querySelector<HTMLElement>('[data-testid="ticket"]');
    if (!ticket) throw new Error('no ticket');
    expect(ticket.tagName).toBe('ARTICLE');
    expect(ticket.classList.contains('ui-coupon-card')).toBe(true);
    expect(ticket.hasAttribute('type')).toBe(false);
    expect(ticket.hasAttribute('data-interactive')).toBe(false);
    expect(ticket.hasAttribute('data-applied')).toBe(true);
    // The parts, stamped for a test.
    expect(host.querySelector('[data-testid="line-value"]')?.textContent).toBe(
      '−5,00 €',
    );
    expect(host.querySelector('[data-testid="line-code"]')?.textContent).toBe(
      'BEARD5',
    );
    expect(host.querySelector('[data-testid="line-detail"]')?.textContent).toBe(
      'комбинира се',
    );
    // The badge sits inside the glyph's box; the action inside the foot.
    expect(
      host
        .querySelector('[data-testid="badge"]')
        ?.closest('.ui-coupon-card__badge')
        ?.parentElement?.classList.contains('ui-coupon-card__glyph'),
    ).toBe(true);
    const remove = host.querySelector<HTMLButtonElement>(
      '[data-testid="remove"]',
    );
    expect(remove?.closest('.ui-coupon-card__foot')).not.toBeNull();
    expect(ticket.querySelector('.ui-coupon-card__action')).toBeNull();
    remove?.click();
    expect(fixture.componentInstance.removed).toBe(1);
  });
});
