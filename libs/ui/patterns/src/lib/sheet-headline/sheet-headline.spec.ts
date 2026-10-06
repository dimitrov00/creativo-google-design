import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  UI_SHEET_HEADLINE,
  UiHeadlineMedia,
  UiHeadlinePlate,
  UiSheetHeadline,
  type UiHeadlineMediaTone,
  type UiHeadlineStyle,
} from './sheet-headline';

@Component({
  imports: [UiSheetHeadline],
  template: `
    <ui-sheet-headline [uiFolded]="folded()">
      <h2 uiSheetLargeTitle id="t">Добави услуга</h2>
      <p>За Кирил Тодоров</p>
    </ui-sheet-headline>
  `,
})
class Host {
  readonly folded = signal(false);
}

describe('UiSheetHeadline', () => {
  let fixture: ComponentFixture<Host>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Host],
    }).compileComponents();
    fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
  });

  it("holds the title and its one line in one body, and folds on the owner's word", () => {
    const host = fixture.nativeElement.querySelector(
      'ui-sheet-headline',
    ) as HTMLElement;
    const body = host.querySelector('.ui-sheet-headline__body');
    expect(body?.querySelector('h2')?.textContent).toBe('Добави услуга');
    expect(body?.querySelector('p')?.textContent).toBe('За Кирил Тодоров');
    expect(host.hasAttribute('data-folded')).toBe(false);
    fixture.componentInstance.folded.set(true);
    fixture.detectChanges();
    expect(host.hasAttribute('data-folded')).toBe(true);
  });

  it('keeps a head without a face the one text column it always was', () => {
    const host = fixture.nativeElement.querySelector(
      'ui-sheet-headline',
    ) as HTMLElement;
    const body = host.querySelector(':scope > .ui-sheet-headline__body');
    const text = body?.querySelector(':scope > .ui-sheet-headline__text');
    expect(
      Array.from(text?.children ?? []).map((child) => child.tagName),
    ).toEqual(['H2', 'P']);
    const media = body?.querySelector(':scope > .ui-sheet-headline__media');
    expect(media?.childElementCount).toBe(0);
    expect(host.hasAttribute('data-media')).toBe(false);
    expect(host.hasAttribute('data-media-tone')).toBe(false);
  });

  it('is the standard head unless told otherwise, and says so on its host', () => {
    const host = fixture.nativeElement.querySelector(
      'ui-sheet-headline',
    ) as HTMLElement;
    expect(host.getAttribute('data-headline-style')).toBe('standard');
    expect(host.hasAttribute('data-media-stage')).toBe(false);
    expect(host.hasAttribute('data-plate')).toBe(false);
  });
});

/*
 * THE FACE (2026-09-28). A patterns spec cannot mount `ui-avatar` (controls
 * import patterns, never the reverse), so a plain disc stands in for it: the
 * head only has to know a face is there, never what it is.
 */
@Component({
  imports: [UI_SHEET_HEADLINE],
  template: `
    <ui-sheet-headline [uiMediaTone]="tone()">
      <h2 uiSheetLargeTitle id="client-title">Георги Петров</h2>
      <p>Клиент от март 2025 г. · идва на ~4 седмици</p>
      @if (face()) {
        <span uiHeadlineMedia data-testid="face">ГП</span>
      }
    </ui-sheet-headline>
  `,
})
class FaceHost {
  readonly tone = signal<UiHeadlineMediaTone | null>(null);
  readonly face = signal(true);
}

/** The bundle rule, documented: the head alone never learns of the face. */
@Component({
  imports: [UiSheetHeadline],
  template: `
    <ui-sheet-headline uiMediaTone="warning">
      <h2 uiSheetLargeTitle>Георги Петров</h2>
      <span uiHeadlineMedia data-testid="face">ГП</span>
    </ui-sheet-headline>
  `,
})
class LoneHost {}

describe('UiSheetHeadline · the face', () => {
  const headOf = (root: HTMLElement): HTMLElement =>
    root.querySelector('ui-sheet-headline') as HTMLElement;

  async function mount<T>(type: new () => T): Promise<ComponentFixture<T>> {
    await TestBed.configureTestingModule({
      imports: [type],
      errorOnUnknownElements: true,
      errorOnUnknownProperties: true,
    }).compileComponents();
    const fixture = TestBed.createComponent(type);
    fixture.detectChanges();
    return fixture;
  }

  it('stamps data-media and seats the face TRAILING, after the text column', async () => {
    const fixture = await mount(FaceHost);
    const host = headOf(fixture.nativeElement);
    expect(host.getAttribute('data-media')).toBe('');
    const body = host.querySelector(':scope > .ui-sheet-headline__body');
    expect(Array.from(body?.children ?? []).map((c) => c.className)).toEqual([
      'ui-sheet-headline__text',
      'ui-sheet-headline__media',
    ]);
    const media = body?.querySelector(':scope > .ui-sheet-headline__media');
    const face = media?.querySelector('[data-testid="face"]');
    expect(face?.classList.contains('ui-headline-media')).toBe(true);
    // The h2 and its line say it in words; the face is decoration.
    expect(media?.getAttribute('aria-hidden')).toBe('true');
    expect(
      host.querySelector('.ui-sheet-headline__text [data-testid="face"]'),
    ).toBeNull();
  });

  it('rings the face with uiMediaTone, and only while there is a face to ring', async () => {
    const fixture = await mount(FaceHost);
    const host = headOf(fixture.nativeElement);
    expect(host.hasAttribute('data-media-tone')).toBe(false);

    fixture.componentInstance.tone.set('warning');
    fixture.detectChanges();
    expect(host.getAttribute('data-media-tone')).toBe('warning');

    fixture.componentInstance.face.set(false);
    fixture.detectChanges();
    expect(host.hasAttribute('data-media')).toBe(false);
    expect(host.hasAttribute('data-media-tone')).toBe(false);
  });

  it('projects the node but draws no media column when only UiSheetHeadline is imported', async () => {
    const fixture = await mount(LoneHost);
    const host = headOf(fixture.nativeElement);
    expect(
      host.querySelector('.ui-sheet-headline__media [data-testid="face"]'),
    ).not.toBeNull();
    expect(host.hasAttribute('data-media')).toBe(false);
    expect(host.hasAttribute('data-media-tone')).toBe(false);
  });
});

/*
 * THE HERO (revision 3, R2-C). The same stand-ins: a plain disc for the
 * avatar, a plain capsule for the badge. The ring is the pattern's own
 * `ui-gauge`, so it is the real one.
 */
@Component({
  imports: [UI_SHEET_HEADLINE],
  template: `
    <ui-sheet-headline
      [uiHeadlineStyle]="style()"
      [uiMediaTone]="tone()"
      [uiMediaValue]="value()"
      [uiMediaStage]="stage()"
    >
      <h2 uiSheetLargeTitle id="client-title">Георги Петров</h2>
      <p>Клиент от март 2025 г. · идва през 4 седмици</p>
      <span data-testid="words">Злато, още 7 посещения до Платина</span>
      @if (face()) {
        <span uiHeadlineMedia data-testid="face">ГП</span>
      }
      @if (plate()) {
        <span uiHeadlinePlate data-testid="plate">Злато</span>
      }
    </ui-sheet-headline>
  `,
})
class HeroHost {
  readonly style = signal<UiHeadlineStyle>('hero');
  readonly tone = signal<UiHeadlineMediaTone | null>(null);
  readonly value = signal<number | null>(0.4);
  readonly stage = signal(false);
  readonly face = signal(true);
  readonly plate = signal(true);
}

/** The attribute forms a template writes: `uiMediaStage` alone is `true`. */
@Component({
  imports: [UI_SHEET_HEADLINE],
  template: `
    <ui-sheet-headline uiHeadlineStyle="hero" uiMediaStage>
      <h2 uiSheetLargeTitle>Фейд</h2>
      <p>Майсторство · Ниво II · от 24.09.2025 г.</p>
      <span uiHeadlineMedia data-testid="face">II</span>
    </ui-sheet-headline>
  `,
})
class StageHost {}

describe('UiSheetHeadline · the hero', () => {
  const headOf = (root: HTMLElement): HTMLElement =>
    root.querySelector('ui-sheet-headline') as HTMLElement;
  const mediaOf = (root: HTMLElement): HTMLElement =>
    root.querySelector(
      'ui-sheet-headline > .ui-sheet-headline__body > .ui-sheet-headline__media',
    ) as HTMLElement;
  const ringOf = (root: HTMLElement): HTMLElement | null =>
    mediaOf(root).querySelector(':scope > ui-gauge.ui-sheet-headline__ring');

  async function mount<T>(type: new () => T): Promise<ComponentFixture<T>> {
    await TestBed.configureTestingModule({
      imports: [type],
      errorOnUnknownElements: true,
      errorOnUnknownProperties: true,
    }).compileComponents();
    const fixture = TestBed.createComponent(type);
    fixture.detectChanges();
    return fixture;
  }

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('bundles the head, its face and its plate', () => {
    expect(UI_SHEET_HEADLINE).toEqual([
      UiSheetHeadline,
      UiHeadlineMedia,
      UiHeadlinePlate,
    ]);
  });

  it('stamps data-headline-style, and keeps the DOM title first: the media is only MOVED above', async () => {
    // The host flips to `standard` with its ring and plate still set: the
    // development warning is another case's subject.
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const fixture = await mount(HeroHost);
    const host = headOf(fixture.nativeElement);
    expect(host.getAttribute('data-headline-style')).toBe('hero');
    expect(host.getAttribute('data-media')).toBe('');
    const body = host.querySelector(':scope > .ui-sheet-headline__body');
    expect(Array.from(body?.children ?? []).map((c) => c.className)).toEqual([
      'ui-sheet-headline__text',
      'ui-sheet-headline__media',
    ]);
    // The name, the line and the ring's words: what a reader meets, in order.
    const text = body?.querySelector(':scope > .ui-sheet-headline__text');
    expect(
      Array.from(text?.children ?? []).map((child) => child.tagName),
    ).toEqual(['H2', 'P', 'SPAN']);

    fixture.componentInstance.style.set('standard');
    fixture.detectChanges();
    expect(host.getAttribute('data-headline-style')).toBe('standard');
  });

  it('draws the ring round the face: the circular gauge, extraLarge, filled to uiMediaValue', async () => {
    const fixture = await mount(HeroHost);
    const ring = ringOf(fixture.nativeElement);
    expect(ring).not.toBeNull();
    expect(ring?.getAttribute('data-gauge-style')).toBe('circularCapacity');
    expect(ring?.getAttribute('data-control-size')).toBe('extraLarge');
    expect(ring?.style.getPropertyValue('--ui-gauge-value')).toBe('0.4');
    expect(ring?.hasAttribute('data-tone')).toBe(false);
    expect(ring?.hasAttribute('data-complete')).toBe(false);
    // Presentational: the consumer says the ring in words, after the line.
    expect(ring?.getAttribute('aria-hidden')).toBe('true');
    // The ring is written BEFORE the face: the face stands over it.
    const media = mediaOf(fixture.nativeElement);
    const face = media.querySelector('[data-testid="face"]') as HTMLElement;
    expect(
      (ring as HTMLElement).compareDocumentPosition(face) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('draws no ring for a null value, and keeps the media (the box is CSS, so nothing moves)', async () => {
    const fixture = await mount(HeroHost);
    fixture.componentInstance.value.set(null);
    fixture.detectChanges();
    expect(ringOf(fixture.nativeElement)).toBeNull();
    const host = headOf(fixture.nativeElement);
    expect(host.getAttribute('data-media')).toBe('');
    expect(
      mediaOf(fixture.nativeElement).querySelector('[data-testid="face"]'),
    ).not.toBeNull();
  });

  it('draws the track alone at zero, a full ring at one, and clamps what lies outside', async () => {
    const fixture = await mount(HeroHost);
    const value = (next: number): HTMLElement => {
      fixture.componentInstance.value.set(next);
      fixture.detectChanges();
      return ringOf(fixture.nativeElement) as HTMLElement;
    };
    expect(value(0).hasAttribute('data-empty')).toBe(true);
    expect(value(1).hasAttribute('data-complete')).toBe(true);
    expect(value(1.7).style.getPropertyValue('--ui-gauge-value')).toBe('1');
    expect(value(-3).style.getPropertyValue('--ui-gauge-value')).toBe('0');
    expect(value(Number.NaN).style.getPropertyValue('--ui-gauge-value')).toBe(
      '0',
    );
  });

  it('lets the WARNING ring win: full, in the warning tone, whatever the value says', async () => {
    const fixture = await mount(HeroHost);
    fixture.componentInstance.tone.set('warning');
    fixture.detectChanges();
    const host = headOf(fixture.nativeElement);
    expect(host.getAttribute('data-media-tone')).toBe('warning');
    const ring = ringOf(fixture.nativeElement);
    expect(ring?.getAttribute('data-tone')).toBe('warning');
    expect(ring?.hasAttribute('data-complete')).toBe(true);
    expect(ring?.style.getPropertyValue('--ui-gauge-value')).toBe('1');

    // …and with no tier at all (the flag off) the pause still rings.
    fixture.componentInstance.value.set(null);
    fixture.detectChanges();
    expect(ringOf(fixture.nativeElement)?.getAttribute('data-tone')).toBe(
      'warning',
    );
  });

  it('projects the plate INSIDE the media, after the face', async () => {
    const fixture = await mount(HeroHost);
    const host = headOf(fixture.nativeElement);
    const media = mediaOf(fixture.nativeElement);
    const plate = media.querySelector(
      ':scope > [data-testid="plate"]',
    ) as HTMLElement;
    expect(plate).not.toBeNull();
    expect(plate.classList.contains('ui-headline-plate')).toBe(true);
    expect(host.getAttribute('data-plate')).toBe('');
    expect(
      host.querySelector('.ui-sheet-headline__text [data-testid="plate"]'),
    ).toBeNull();
    const face = media.querySelector('[data-testid="face"]') as HTMLElement;
    expect(
      face.compareDocumentPosition(plate) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    fixture.componentInstance.plate.set(false);
    fixture.detectChanges();
    expect(host.hasAttribute('data-plate')).toBe(false);
  });

  it('builds the stage under the face: the spot, then the two discs, all before the ring', async () => {
    const fixture = await mount(HeroHost);
    const host = headOf(fixture.nativeElement);
    const media = mediaOf(fixture.nativeElement);
    expect(host.hasAttribute('data-media-stage')).toBe(false);
    expect(media.querySelector('.ui-sheet-headline__spot')).toBeNull();
    expect(media.querySelector('.ui-sheet-headline__motif')).toBeNull();

    fixture.componentInstance.stage.set(true);
    fixture.detectChanges();
    expect(host.getAttribute('data-media-stage')).toBe('');
    /** A node by its test id, or by the head's own class (and its disc). */
    const named = (child: Element): string =>
      child.getAttribute('data-testid') ??
      [
        Array.from(child.classList).find((name) =>
          name.startsWith('ui-sheet-headline__'),
        ),
        child.getAttribute('data-disc'),
      ]
        .filter((part) => !!part)
        .join(':');
    expect(Array.from(media.children).map(named)).toEqual([
      'ui-sheet-headline__spot',
      'ui-sheet-headline__motif:major',
      'ui-sheet-headline__motif:minor',
      'ui-sheet-headline__ring',
      'face',
      'plate',
    ]);
  });

  it('takes uiMediaStage as a bare attribute, and a medal draws no ring of the head’s', async () => {
    const fixture = await mount(StageHost);
    const host = headOf(fixture.nativeElement);
    expect(host.getAttribute('data-headline-style')).toBe('hero');
    expect(host.getAttribute('data-media-stage')).toBe('');
    expect(ringOf(fixture.nativeElement)).toBeNull();
    expect(host.hasAttribute('data-plate')).toBe(false);
  });

  /*
   * WHAT LEAVES WITH THE FACE. The exit fades ONE box, the media; a node
   * outside it would stay at full ink under the name in the bar. One case
   * per node.
   */
  it.each([
    ['the face', '[data-testid="face"]'],
    ['the ring', 'ui-gauge.ui-sheet-headline__ring'],
    ['the plate', '[data-testid="plate"]'],
    ['the stage’s spot', '.ui-sheet-headline__spot'],
    ['the stage’s larger disc', '.ui-sheet-headline__motif[data-disc="major"]'],
    [
      'the stage’s smaller disc',
      '.ui-sheet-headline__motif[data-disc="minor"]',
    ],
  ])(
    'holds %s inside the media, so it leaves with the face',
    async (_, selector) => {
      const fixture = await mount(HeroHost);
      fixture.componentInstance.stage.set(true);
      fixture.detectChanges();
      const host = headOf(fixture.nativeElement);
      const nodes = host.querySelectorAll(selector);
      expect(nodes).toHaveLength(1);
      const media = mediaOf(fixture.nativeElement);
      expect(nodes[0]?.parentElement).toBe(media);
      // Decoration, all of it: the words are the consumer's, in the text.
      expect(media.getAttribute('aria-hidden')).toBe('true');
    },
  );

  it('draws no ring, no plate’s room and no stage without a face', async () => {
    const fixture = await mount(HeroHost);
    fixture.componentInstance.stage.set(true);
    fixture.componentInstance.tone.set('warning');
    fixture.componentInstance.face.set(false);
    fixture.detectChanges();
    const host = headOf(fixture.nativeElement);
    expect(host.hasAttribute('data-media')).toBe(false);
    expect(host.hasAttribute('data-media-tone')).toBe(false);
    expect(host.hasAttribute('data-media-stage')).toBe(false);
    expect(host.hasAttribute('data-plate')).toBe(false);
    expect(ringOf(fixture.nativeElement)).toBeNull();
    expect(host.querySelector('.ui-sheet-headline__spot')).toBeNull();
  });

  it('keeps the ring, the plate and the stage to the hero, and says so once in development', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await TestBed.configureTestingModule({
      imports: [HeroHost],
    }).compileComponents();
    const fixture = TestBed.createComponent(HeroHost);
    fixture.componentInstance.style.set('standard');
    fixture.componentInstance.stage.set(true);
    fixture.detectChanges();
    await fixture.whenStable();

    const host = headOf(fixture.nativeElement);
    expect(ringOf(fixture.nativeElement)).toBeNull();
    expect(host.hasAttribute('data-media-stage')).toBe(false);
    expect(host.hasAttribute('data-plate')).toBe(false);
    expect(host.querySelector('.ui-sheet-headline__spot')).toBeNull();
    const told = warn.mock.calls.filter(([message]) =>
      String(message).startsWith('[ui-sheet-headline]'),
    );
    expect(told).toHaveLength(1);
    expect(String(told[0]?.[0])).toContain(
      'uiMediaValue, uiMediaStage, [uiHeadlinePlate]',
    );

    // Once: a second change says nothing more.
    fixture.componentInstance.value.set(0.9);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(
      warn.mock.calls.filter(([message]) =>
        String(message).startsWith('[ui-sheet-headline]'),
      ),
    ).toHaveLength(1);
  });

  it('says nothing in development about a hero', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const fixture = await mount(HeroHost);
    fixture.componentInstance.stage.set(true);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(
      warn.mock.calls.filter(([message]) =>
        String(message).startsWith('[ui-sheet-headline]'),
      ),
    ).toHaveLength(0);
  });
});

/*
 * THE LAYOUT, READ FROM THE STYLESHEET. jsdom lays nothing out, so the
 * geometry is held where it is written: the rules a browser would apply.
 */
describe('sheet-headline.css', () => {
  const css = readFileSync(resolve(__dirname, 'sheet-headline.css'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\s+/g, ' ')
    .replace(/\(\s/g, '(')
    .replace(/\s\)/g, ')');

  /** One rule's declarations, found by its exact (whitespace-folded) selector. */
  function rule(selector: string): Map<string, string> {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // eslint-disable-next-line security/detect-non-literal-regexp -- an escaped selector from this spec, over the DS's own stylesheet.
    const match = new RegExp(
      `(?:^|[{};])\\s*${escaped}\\s*\\{([^{}]*)\\}`,
    ).exec(css);
    if (!match) throw new Error(`no rule «${selector}» in sheet-headline.css`);
    const found = new Map<string, string>();
    for (const declaration of (match[1] as string).split(';')) {
      const colon = declaration.indexOf(':');
      if (colon < 0) continue;
      found.set(
        declaration.slice(0, colon).trim(),
        declaration.slice(colon + 1).trim(),
      );
    }
    return found;
  }

  it("moves the body's old recipe one box in, and hides the media column without a face", () => {
    const text = rule('.ui-sheet-headline__text');
    expect(text.get('display')).toBe('flex');
    expect(text.get('flex-direction')).toBe('column');
    expect(text.get('gap')).toBe('var(--sys-space-tight)');
    expect(rule('.ui-sheet-headline__text > *').get('margin')).toBe('0');
    expect(
      rule(
        '.ui-sheet-headline:not([data-media]) .ui-sheet-headline__media',
      ).get('display'),
    ).toBe('none');
    // `clip`, never `hidden`: a hidden box would steal the title's timeline.
    expect(rule('.ui-sheet-headline__body').get('overflow')).toBe('clip');
  });

  it('gives the face a trailing track and floors the text column at the large control', () => {
    const body = rule(
      '.ui-sheet-headline[data-media] .ui-sheet-headline__body',
    );
    expect(body.get('display')).toBe('grid');
    expect(body.get('grid-template-columns')).toBe('minmax(0, 1fr) auto');
    expect(body.get('align-items')).toBe('start');
    const text = rule(
      '.ui-sheet-headline[data-media] .ui-sheet-headline__text',
    );
    expect(text.get('min-block-size')).toBe('var(--control-size-large)');
    expect(text.get('justify-content')).toBe('center');
  });

  it('draws the warning ring INSET, over a surface-coloured gap', () => {
    const ring = rule(
      ".ui-sheet-headline[data-media-tone='warning'] .ui-sheet-headline__media::after",
    );
    expect(ring.get('inset')).toBe('0');
    const shadow = ring.get('box-shadow') ?? '';
    expect(
      shadow.startsWith(
        'inset 0 0 0 var(--sys-stroke-emphasis) var(--sys-color-warning)',
      ),
    ).toBe(true);
    expect(shadow).toContain(
      'inset 0 0 0 calc(var(--sys-stroke-emphasis) * 2) var(--ui-sheet-headline-media-gap, var(--sys-color-surface))',
    );
  });
});

/*
 * THE HERO, READ FROM THE STYLESHEET (revision 3, R2-C). The same reason
 * as above: jsdom lays nothing out and runs no scroll-driven animation, so
 * the geometry and the exit are held where they are written. A capture
 * measures the pixels (scratchpad/v2/d3); these keep the numbers from
 * drifting.
 */
describe('sheet-headline.css · the hero', () => {
  /** A stylesheet as the cascade reads it: comments out, whitespace folded. */
  function stylesheet(path: string): string {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- the DS's own stylesheets.
    return readFileSync(path, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\s+/g, ' ')
      .replace(/\(\s/g, '(')
      .replace(/\s\)/g, ')');
  }

  /** The body of the first block whose prelude is exactly `prelude`. */
  function block(source: string, prelude: string): string {
    const escaped = prelude.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // eslint-disable-next-line security/detect-non-literal-regexp -- an escaped selector from this spec, over the DS's own stylesheet.
    const head = new RegExp(`(?:^|[{};])\\s*${escaped}\\s*\\{`).exec(source);
    if (!head) throw new Error(`no block «${prelude}»`);
    const open = head.index + head[0].length;
    let depth = 1;
    for (let at = open; at < source.length; at += 1) {
      if (source.charAt(at) === '{') depth += 1;
      if (source.charAt(at) === '}' && (depth -= 1) === 0) {
        return source.slice(open, at);
      }
    }
    throw new Error(`unclosed block «${prelude}»`);
  }

  /** A leaf block's declarations, by property. */
  function declarations(body: string): Map<string, string> {
    const found = new Map<string, string>();
    for (const declaration of body.split(';')) {
      const colon = declaration.indexOf(':');
      if (colon < 0) continue;
      found.set(
        declaration.slice(0, colon).trim(),
        declaration.slice(colon + 1).trim(),
      );
    }
    return found;
  }

  /** How many classes, attributes and pseudo-classes a selector counts. */
  const weight = (selector: string): number =>
    (selector.match(/\.[\w-]+|\[[^\]]+\]/g) ?? []).length;

  const layer = block(
    stylesheet(resolve(__dirname, 'sheet-headline.css')),
    '@layer sys-components',
  );
  const header = block(
    stylesheet(resolve(__dirname, '../sheet-header/sheet-header.css')),
    '@layer sys-components',
  );
  const gauge = block(
    stylesheet(resolve(__dirname, '../gauge/gauge.css')),
    '@layer sys-components',
  );
  const rule = (selector: string): Map<string, string> =>
    declarations(block(layer, selector));

  const HERO = ".ui-sheet-headline[data-headline-style='hero']";
  const MEDIA = `${HERO} .ui-sheet-headline__media`;
  const STAGE = `${HERO}[data-media-stage] .ui-sheet-headline__media`;
  const RING_BOX = 'var(--ui-sheet-headline-ring-box)';

  it('rises by the consumer’s --ui-sheet-headline-rise, and by nothing unless it is set', () => {
    const host = rule(HERO);
    expect(host.get('margin-block-start')).toBe(
      'calc(-1 * var(--ui-sheet-headline-rise, 0px))',
    );
    // A folded head has nothing left to lift.
    expect(rule(`${HERO}[data-folded]`).get('margin-block-start')).toBe('0');
  });

  it('sizes the ring box with the gauge’s own sum: 112 and a rim of 8 each side', () => {
    const box = rule(HERO).get('--ui-sheet-headline-ring-box');
    expect(box).toBe(
      'calc(var(--control-size-extraLarge) + var(--sys-space-unit) * 4)',
    );
    // The gauge declares its diameter on ITSELF; the head cannot read it,
    // so it says the same sum, and this holds the two together.
    expect(
      declarations(
        block(
          gauge,
          ".ui-gauge[data-gauge-style='circularCapacity'][data-control-size='extraLarge']",
        ),
      ).get('--ui-gauge-diameter'),
    ).toBe(box);
  });

  it('lays the head out as one centred column, 16 from the face to the name', () => {
    const body = rule(`${HERO} .ui-sheet-headline__body`);
    expect(body.get('display')).toBe('grid');
    expect(body.get('grid-template-columns')).toBe('minmax(0, 1fr)');
    expect(body.get('justify-items')).toBe('center');
    expect(body.get('text-align')).toBe('center');
    expect(body.get('row-gap')).toBe('var(--sys-space-regular)');
    // `clip` still: the hero's body is the same box, and must not become
    // the title's scroll container either.
    expect(rule('.ui-sheet-headline__body').get('overflow')).toBe('clip');
  });

  it('drops the 52 floor under the name and keeps the line 4 under it, balanced', () => {
    const text = rule(`${HERO} .ui-sheet-headline__text`);
    expect(text.get('min-block-size')).toBe('0');
    expect(text.get('align-items')).toBe('center');
    // The gap is the text column's own, untouched: tight.
    expect(text.has('gap')).toBe(false);
    expect(rule('.ui-sheet-headline__text').get('gap')).toBe(
      'var(--sys-space-tight)',
    );
    expect(rule(`${HERO} .ui-sheet-headline__text > *`).get('text-wrap')).toBe(
      'balance',
    );
  });

  it('moves the media above the name, in a ring box it keeps with a ring or without', () => {
    const media = rule(MEDIA);
    expect(media.get('order')).toBe('-1');
    expect(media.get('display')).toBe('grid');
    expect(media.get('place-items')).toBe('center');
    expect(media.get('inline-size')).toBe(RING_BOX);
    expect(media.get('block-size')).toBe(RING_BOX);
    // ONE cell: the spot, the ring, the face and the plate share it.
    expect(rule(`${MEDIA} > *`).get('grid-area')).toBe('1 / 1');
  });

  it('lets a drag that starts on the face through to the sheet', () => {
    expect(rule(MEDIA).get('pointer-events')).toBe('none');
  });

  it('tints the warning ring through the gauge’s own hook, and retires the inset ring in the hero', () => {
    expect(
      rule(".ui-sheet-headline__ring[data-tone='warning']").get(
        '--ui-gauge-tint',
      ),
    ).toBe('var(--sys-color-warning)');
    expect(
      rule(
        `${HERO}[data-media-tone='warning'] .ui-sheet-headline__media::after`,
      ).get('content'),
    ).toBe('none');
  });

  it('stands the plate ON the ring box’s bottom edge, and keeps the name 16 from the plate', () => {
    const plate = rule(`${MEDIA} > .ui-headline-plate`);
    expect(plate.get('place-self')).toBe('center');
    expect(plate.get('translate')).toBe(`0 calc(${RING_BOX} / 2)`);
    expect(plate.get('min-block-size')).toBe('var(--ui-sheet-headline-plate)');
    expect(plate.get('white-space')).toBe('nowrap');
    expect(plate.get('box-shadow')).toBe('var(--sys-elevation-raised)');
    expect(rule(HERO).get('--ui-sheet-headline-plate')).toBe(
      'calc(var(--sys-space-unit) * 6)',
    );
    // Half the plate hangs under the box; on the stage it ends inside it.
    expect(
      rule(
        `${HERO}[data-plate]:not([data-media-stage]) .ui-sheet-headline__media`,
      ).get('margin-block-end'),
    ).toBe('calc(var(--ui-sheet-headline-plate) / 2)');
    // A standard head has no rim to stand a plate on.
    expect(
      rule(
        ".ui-sheet-headline:not([data-headline-style='hero']) .ui-headline-plate",
      ).get('display'),
    ).toBe('none');
  });

  it('builds the stage: the column wide, the ring box and 24 above and under it, an accent WASH', () => {
    const stage = rule(STAGE);
    expect(stage.get('justify-self')).toBe('stretch');
    expect(stage.get('inline-size')).toBe('auto');
    expect(stage.get('block-size')).toBe(
      `calc(${RING_BOX} + 2 * var(--sys-space-comfortable))`,
    );
    expect(stage.get('border-radius')).toBe('var(--control-radius-prominent)');
    expect(stage.get('background')).toBe(
      'color-mix(in srgb, var(--sys-color-accent) var(--sys-alpha-tint), transparent)',
    );
    expect(stage.get('overflow')).toBe('clip');
    expect(stage.get('container-type')).toBe('inline-size');
    expect(stage.get('isolation')).toBe('isolate');
    // A medal on the stage stands on the spot: its rim numeral is cut out
    // of its ring in the spot's colour, not the sheet's.
    expect(stage.get('--ui-medal-stack-ring')).toBe(
      rule('.ui-sheet-headline__spot').get('background'),
    );
  });

  it('puts a white spot under the ring, 12 wider all round, so the arc is read on white', () => {
    const spot = rule('.ui-sheet-headline__spot');
    const size = `calc(${RING_BOX} + var(--sys-space-unit) * 6)`;
    expect(spot.get('inline-size')).toBe(size);
    expect(spot.get('block-size')).toBe(size);
    expect(spot.get('border-radius')).toBe('var(--control-radius-capsule)');
    expect(spot.get('background')).toBe('var(--sys-color-surface-elevated)');
    // In the cell, never positioned: it paints under the ring written after
    // it, and over the motif's negative layer.
    expect(spot.has('position')).toBe(false);
    expect(spot.has('z-index')).toBe(false);
  });

  it('draws the pass’s two discs in the trailing 40 %, under the spot, and drops them in a narrow panel', () => {
    const motif = rule('.ui-sheet-headline__motif');
    expect(motif.get('position')).toBe('absolute');
    expect(motif.get('z-index')).toBe('-1');
    expect(motif.get('background')).toBe(
      'color-mix(in srgb, var(--sys-color-accent) 10%, transparent)',
    );
    const major = rule(".ui-sheet-headline__motif[data-disc='major']");
    const minor = rule(".ui-sheet-headline__motif[data-disc='minor']");
    // 220 and 140, the pass's.
    expect(major.get('inline-size')).toBe('calc(var(--sys-space-unit) * 55)');
    expect(major.get('block-size')).toBe('calc(var(--sys-space-unit) * 55)');
    expect(minor.get('inline-size')).toBe('calc(var(--sys-space-unit) * 35)');
    expect(minor.get('block-size')).toBe('calc(var(--sys-space-unit) * 35)');
    for (const disc of [major, minor]) {
      const start = Number.parseFloat(disc.get('inset-inline-start') ?? '');
      expect(disc.get('inset-inline-start')).toMatch(/^\d+%$/);
      expect(start).toBeGreaterThanOrEqual(60);
    }
    expect(
      declarations(
        block(
          block(layer, '@container (inline-size < 20rem)'),
          '.ui-sheet-headline__motif',
        ),
      ).get('display'),
    ).toBe('none');
    // No gradient and no motion anywhere on the stage.
    expect(layer).not.toContain('gradient(');
    for (const part of [motif, major, minor, rule(STAGE)]) {
      expect(part.has('animation')).toBe(false);
      expect(part.has('transition')).toBe(false);
    }
  });

  describe('the media’s own exit', () => {
    const OWN = `${HERO}[data-media] .ui-sheet-headline__media`;
    const HEADERS = '.ui-sheet-headline[data-media] .ui-sheet-headline__media';
    const scrollLinked = block(
      block(layer, '@supports (animation-timeline: view())'),
      '@media (prefers-reduced-motion: no-preference)',
    );

    it('gives the hero’s media a view-timeline of its own, inset by the chrome LESS the rise', () => {
      const exit = declarations(block(scrollLinked, OWN));
      expect(exit.get('view-timeline-name')).toBe('--ui-sheet-headline-media');
      expect(exit.get('view-timeline-inset')).toBe(
        'calc(var(--modal-sheet-chrome-height, var(--control-size-large)) - var(--ui-sheet-headline-rise, 0px)) auto',
      );
      expect(exit.get('animation-timeline')).toBe('--ui-sheet-headline-media');
      expect(exit.get('animation-range')).toBe('exit 0% exit 55%');
    });

    it('re-aims the header’s fade and leaves its animation alone', () => {
      const exit = declarations(block(scrollLinked, OWN));
      // The keyframes stay the header's: this rule names no animation, and
      // the shorthand would reset the timeline it has just set.
      expect(exit.has('animation')).toBe(false);
      expect(exit.has('animation-name')).toBe(false);
      expect([...exit.keys()].sort()).toEqual([
        'animation-range',
        'animation-timeline',
        'view-timeline-inset',
        'view-timeline-name',
      ]);
      // The header's rule is still there, selector and all…
      const headers = declarations(
        block(
          block(
            block(header, '@supports (animation-timeline: view())'),
            '@media (prefers-reduced-motion: no-preference)',
          ),
          `[uisheetlargetitle], ${HEADERS}`,
        ),
      );
      expect(headers.get('animation')).toBe(
        'ui-sheet-headline-out linear both',
      );
      // …and this one outweighs it in the same layer.
      expect(weight(OWN)).toBeGreaterThan(weight(HEADERS));
    });

    it('lives only where the timeline runs and motion is allowed', () => {
      const outside = layer.replace(
        block(layer, '@supports (animation-timeline: view())'),
        '',
      );
      // (`--ui-sheet-headline-media-gap` is the trailing ring's old hook.)
      expect(outside).not.toMatch(/--ui-sheet-headline-media(?!-)/);
      expect(outside).not.toContain('animation-range');
      // (The two `@supports` preludes name the property; no rule sets it.)
      expect(outside).not.toMatch(/animation-timeline:\s*--/);
    });

    it('falls back to the header’s flip: collapsed, the media is gone', () => {
      const FALLBACK = `.ui-sheet__surface:has(.ui-sheet-header[data-collapsed]) ${MEDIA}`;
      expect(rule(FALLBACK).get('opacity')).toBe('0');
      // Outside the scroll-linked branch: it is what engines WITHOUT the
      // timeline, and reduced motion, are left with.
      expect(scrollLinked).not.toContain('opacity');
      const supports = block(layer, '@supports (animation-timeline: view())');
      expect(supports).not.toContain('data-collapsed');
    });

    it('fades the flip only where there is no timeline and motion is allowed', () => {
      const flip = declarations(
        block(
          block(
            block(layer, '@supports not (animation-timeline: view())'),
            '@media (prefers-reduced-motion: no-preference)',
          ),
          MEDIA,
        ),
      );
      expect(flip.get('transition')).toBe(
        'opacity var(--sys-motion-duration-deliberate) var(--sys-motion-ease-standard)',
      );
    });
  });

  it('colours shapes only: no rule of the head sets an ink', () => {
    // The accent law: the ring, the wash and the discs are shapes. The
    // words are the consumer's, in ink.
    expect(layer).not.toMatch(/(?:^|[;{\s])color\s*:/);
  });

  it('leaves the trailing layout as it was', () => {
    const body = rule(
      '.ui-sheet-headline[data-media] .ui-sheet-headline__body',
    );
    expect(body.get('grid-template-columns')).toBe('minmax(0, 1fr) auto');
    expect(
      rule('.ui-sheet-headline[data-media] .ui-sheet-headline__text').get(
        'min-block-size',
      ),
    ).toBe('var(--control-size-large)');
    // Every hero rule is scoped by the style, the stage's parts and the
    // ring's tone by their own class.
    const selectors = [...layer.matchAll(/(?:^|[{};])\s*([^{};@]+?)\s*\{/g)]
      .map(([, selector]) => selector as string)
      .filter((selector) => !/^(from|to|\d+%)$/.test(selector));
    const added = selectors.filter(
      (selector) =>
        selector.includes('hero') ||
        selector.includes('__spot') ||
        selector.includes('__motif') ||
        selector.includes('__ring') ||
        selector.includes('ui-headline-plate'),
    );
    expect(added.length).toBeGreaterThan(10);
    for (const selector of selectors) {
      if (added.includes(selector)) continue;
      expect(selector).not.toContain('data-headline-style');
    }
  });
});
