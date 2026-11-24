import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import {
  UiProgressDisc,
  type UiProgressDiscPhase,
  type UiProgressDiscSize,
} from './progress-disc';

const css = readFileSync(resolve(__dirname, 'progress-disc.css'), 'utf8');

@Component({
  imports: [UiProgressDisc],
  template: `
    <ui-progress-disc [uiPhase]="phase()" [uiControlSize]="size()">
      <span data-testid="symbol">✉</span>
    </ui-progress-disc>
  `,
})
class Host {
  readonly phase = signal<UiProgressDiscPhase>('idle');
  readonly size = signal<UiProgressDiscSize>('regular');
}

function render() {
  const fixture = TestBed.createComponent(Host);
  fixture.detectChanges();
  const disc = fixture.nativeElement.querySelector(
    '.ui-progress-disc',
  ) as HTMLElement;
  return { fixture, disc };
}

describe('UiProgressDisc', () => {
  it('names its phase and size on the host, idle and regular by default', () => {
    const { fixture, disc } = render();
    expect(disc.dataset['phase']).toBe('idle');
    expect(disc.dataset['controlSize']).toBe('regular');

    for (const phase of ['busy', 'acknowledged', 'complete'] as const) {
      fixture.componentInstance.phase.set(phase);
      fixture.detectChanges();
      expect(disc.dataset['phase']).toBe(phase);
    }
    fixture.componentInstance.size.set('large');
    fixture.detectChanges();
    expect(disc.dataset['controlSize']).toBe('large');
  });

  it('projects the symbol into the disc’s face', () => {
    const { disc } = render();
    expect(
      disc.querySelector('.ui-progress-disc__glyph [data-testid="symbol"]'),
    ).not.toBeNull();
  });

  it('is decorative — the words beside it say its state', () => {
    const { disc } = render();
    expect(disc.getAttribute('aria-hidden')).toBe('true');
  });

  it('keeps one element per part across phases, so a phase change transitions rather than remounts', () => {
    const { fixture, disc } = render();
    const face = disc.querySelector('.ui-progress-disc__face');
    fixture.componentInstance.phase.set('complete');
    fixture.detectChanges();
    expect(disc.querySelector('.ui-progress-disc__face')).toBe(face);
    expect(disc.querySelectorAll('.ui-progress-disc__check')).toHaveLength(1);
    expect(disc.querySelectorAll('.ui-progress-disc__badge')).toHaveLength(1);
    expect(disc.querySelectorAll('.ui-progress-disc__ring')).toHaveLength(1);
  });

  it('keeps the ring out of the global reduced-motion kill-switch — busy is a state the person must see', () => {
    const { disc } = render();
    expect(
      disc
        .querySelector('.ui-progress-disc__ring')
        ?.hasAttribute('data-motion-essential'),
    ).toBe(true);
  });
});

describe('progress-disc.css', () => {
  it('turns the ring only while busy — nothing spins unseen', () => {
    expect(css).toMatch(
      /\[data-phase='busy'\] \.ui-progress-disc__ring \{[^}]*animation: ui-progress-disc-spin/,
    );
    // The bare rule (a line of its own) carries no animation at all.
    expect(css).not.toMatch(/^\s*\.ui-progress-disc__ring \{[^}]*animation/m);
  });

  it('lifts the reset’s svg cap off the ring, which is drawn wider than the disc', () => {
    expect(css).toMatch(
      /\.ui-progress-disc__ring \{[^}]*max-inline-size: none;/,
    );
  });

  it('draws the check in on-accent ink, never the background (near-black in dark)', () => {
    expect(css).toMatch(
      /\.ui-progress-disc__check \{[^}]*stroke: var\(--sys-color-on-accent\)/,
    );
    expect(css).not.toMatch(/stroke: var\(--sys-color-background\)/);
  });

  it('fills the disc with the accent only when complete', () => {
    expect(css).toMatch(
      /\[data-phase='complete'\] \.ui-progress-disc__face \{\s*background: var\(--sys-color-accent\);/,
    );
  });

  it('under reduced motion, paints the check at once and breathes the busy ring instead of turning it', () => {
    const reduced = css.slice(css.indexOf('@media (prefers-reduced-motion'));
    expect(reduced).toMatch(/stroke-dashoffset: 0/);
    expect(reduced).toMatch(/animation: ui-progress-disc-breathe/);
  });
});
