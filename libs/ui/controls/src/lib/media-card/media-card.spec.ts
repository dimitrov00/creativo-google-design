import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { UiBadge } from '../badge/badge';
import { UiMediaCard } from './media-card';

@Component({
  imports: [UiMediaCard],
  template: `
    <ui-media-card
      data-testid="card"
      uiRadius="prominent"
      uiRatio="1 / 1"
      [uiSrc]="src()"
      uiAlt="cover"
    >
      <span uiPlaceholder class="motif">scissors</span>
      <span uiCaption class="name">Classic cut</span>
      <span uiCaption class="meta">from 13 €</span>
      @if (bundle()) {
        <span uiOverlayTrailing class="chip">layers</span>
      }
      <span uiOverlayLeading class="info">i</span>
    </ui-media-card>
  `,
})
class HostComponent {
  src = signal<string | null>('/cover.jpg');
  bundle = signal(true);
}

/** The client card's photo tile: a date capsule projected straight into the caption. */
@Component({
  imports: [UiMediaCard, UiBadge],
  template: `
    <ui-media-card uiRatio="4 / 5" [uiSrc]="null" [uiScrim]="false">
      <span uiBadge uiCaption [uiOnMedia]="true" class="date">7.08</span>
      <span uiCaption class="line">Фейд</span>
    </ui-media-card>
  `,
})
class PhotoTileHost {}

describe('UiMediaCard', () => {
  let fixture: ComponentFixture<HostComponent>;
  let card: HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HostComponent],
    }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    card = fixture.nativeElement.querySelector('[data-testid="card"]');
  });

  it('stamps the host class, the on-media context and the composed radius', () => {
    expect(card.classList.contains('ui-media-card')).toBe(true);
    expect(card.hasAttribute('data-on-media')).toBe(true);
    // Radius rides the shared uiRadius modifier via hostDirectives.
    expect(card.getAttribute('data-radius')).toBe('prominent');
  });

  it('drives ui-async-image from its own source/ratio inputs', () => {
    const image: HTMLElement | null = card.querySelector('ui-async-image');
    expect(image?.style.aspectRatio).toBe('1 / 1');
    expect(card.querySelector('img')?.getAttribute('src')).toBe('/cover.jpg');
  });

  it('forwards projected placeholder art into the image placeholder slot', () => {
    // The wrapper carries uiPlaceholder so ui-async-image matches it — a
    // bare nested <ng-content select> would never reach the child's slot.
    const placeholder = card.querySelector(
      '.ui-async-image__placeholder > .ui-media-card__placeholder',
    );
    expect(placeholder).not.toBeNull();
    expect(placeholder?.querySelector('.motif')).not.toBeNull();
  });

  it('collects every caption line into the one inset stack, in order', () => {
    const caption = card.querySelector('.ui-media-card__caption');
    expect(
      Array.from(caption?.children ?? []).map((el) => el.className),
    ).toEqual(['name', 'meta']);
  });

  it('renders the media scrim only while a caption is shown', () => {
    expect(card.querySelector('[data-overlay="scrim-media"]')).not.toBeNull();
  });

  it('projects corner accessories as direct children, conditionals included', () => {
    expect(card.querySelector(':scope > .info')).not.toBeNull();
    expect(card.querySelector(':scope > .chip')).not.toBeNull();

    fixture.componentInstance.bundle.set(false);
    fixture.detectChanges();
    expect(card.querySelector('.chip')).toBeNull();
  });
});

describe('media-card.css · the tap target', () => {
  // The card is never the control; a button or a link whose one child is
  // the card is — the DS strips its UA chrome once (jsdom lays nothing
  // out, so the stylesheet is the contract).
  const css = readFileSync(resolve(__dirname, 'media-card.css'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\s+/g, ' ');

  it('resets a button or link that wraps a media card and nothing else', () => {
    const body =
      /:is\(button, a\):has\(> \.ui-media-card:only-child\) \{([^}]*)\}/.exec(
        css,
      )?.[1] ?? '';
    for (const declaration of [
      'padding: 0;',
      'border: 0;',
      'background: none;',
      'color: inherit;',
      'font: inherit;',
    ]) {
      expect(body).toContain(declaration);
    }
  });

  it('lets an on-media badge in the caption hug its label, never stretch across the tile', () => {
    // The caption is a grid, and a grid item stretches by default: the
    // photo rail's «7.08» ran edge to edge. jsdom lays nothing out, so the
    // stylesheet is the contract, and the selector is checked against the
    // badge exactly as a consumer projects it.
    const selector = '.ui-media-card__caption > .ui-badge';
    const body =
      /\.ui-media-card__caption > \.ui-badge \{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(body).toContain('justify-self: start;');

    TestBed.configureTestingModule({
      imports: [PhotoTileHost],
      errorOnUnknownElements: true,
      errorOnUnknownProperties: true,
    });
    const fixture = TestBed.createComponent(PhotoTileHost);
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    const badge = root.querySelector('.date') as HTMLElement;
    expect(badge.classList.contains('ui-badge')).toBe(true);
    expect(badge.hasAttribute('data-on-media')).toBe(true);
    expect(badge.matches(selector)).toBe(true);
    expect((root.querySelector('.line') as HTMLElement).matches(selector)).toBe(
      false,
    );
  });

  it('matches only a wrapper whose one child is the card', () => {
    const selector = ':is(button, a):has(> .ui-media-card:only-child)';
    const host = document.createElement('div');
    host.innerHTML =
      '<button id="thumb"><ui-media-card class="ui-media-card"></ui-media-card></button>' +
      '<button id="labelled"><ui-media-card class="ui-media-card"></ui-media-card><span>Фейд</span></button>' +
      '<a id="link" href="#"><ui-media-card class="ui-media-card"></ui-media-card></a>';
    const matches = (id: string) =>
      (host.querySelector(`#${id}`) as HTMLElement).matches(selector);
    expect(matches('thumb')).toBe(true);
    expect(matches('link')).toBe(true);
    expect(matches('labelled')).toBe(false);
  });
});
