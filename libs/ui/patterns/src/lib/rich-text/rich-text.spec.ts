import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { RichSpanStyle, RichText } from '@core/components';
import { ProgramImageId } from '@core/primitives';
import { UiRichText, type UiRichImageSource } from './rich-text';

const plain = (text: string) => RichText.span(text);

@Component({
  imports: [UiRichText],
  template: `<ui-rich-text
    [uiBlocks]="blocks()"
    [uiHeadingLevel]="level()"
    [uiImageSource]="source()"
  />`,
})
class HostComponent {
  blocks = signal<RichText>([]);
  level = signal(2);
  source = signal<UiRichImageSource | null>(null);
}

describe('UiRichText', () => {
  let fixture: ComponentFixture<HostComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HostComponent],
    }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
  });

  function draw(blocks: RichText): HTMLElement {
    fixture.componentInstance.blocks.set(blocks);
    fixture.detectChanges();
    return fixture.nativeElement.querySelector('ui-rich-text');
  }

  it('draws nothing for no blocks', () => {
    expect(draw([]).children).toHaveLength(0);
  });

  it('draws the two heading levels under the host’s own, as headings', () => {
    const host = draw([
      RichText.heading(1, [plain('What you do')]),
      RichText.heading(2, [plain('Day to day')]),
    ]);
    const headings = Array.from(host.querySelectorAll('[role="heading"]'));
    expect(headings.map((h) => h.textContent?.trim())).toEqual([
      'What you do',
      'Day to day',
    ]);
    expect(headings.map((h) => h.getAttribute('aria-level'))).toEqual([
      '2',
      '3',
    ]);

    fixture.componentInstance.level.set(3);
    fixture.detectChanges();
    expect(headings.map((h) => h.getAttribute('aria-level'))).toEqual([
      '3',
      '4',
    ]);
  });

  it('draws a paragraph’s runs as plain, bold and italic text, with no space of its own', () => {
    const host = draw([
      RichText.paragraph([
        plain('A '),
        RichText.span('bold', RichSpanStyle.Bold),
        plain(', '),
        RichText.span('slanted', RichSpanStyle.Italic),
        plain(' and '),
        RichText.span('both', RichSpanStyle.BoldItalic),
        plain('.'),
      ]),
    ]);
    const paragraph = host.querySelector('p.ui-rich-text__paragraph');
    expect(paragraph?.textContent).toBe('A bold, slanted and both.');
    expect(
      Array.from(host.querySelectorAll('strong')).map((e) => e.textContent),
    ).toEqual(['bold', 'both']);
    expect(
      Array.from(host.querySelectorAll('em')).map((e) => e.textContent),
    ).toEqual(['slanted', 'both']);
  });

  it('draws a bulleted list and a numbered list, one item per row', () => {
    const host = draw([
      RichText.list(false, [[plain('Fades')], [plain('Beards')]]),
      RichText.list(true, [[plain('Write')], [plain('Come by')]]),
    ]);
    const items = (selector: string) =>
      Array.from(host.querySelectorAll(`${selector} > li`)).map(
        (item) => item.textContent,
      );
    expect(items('ul')).toEqual(['Fades', 'Beards']);
    expect(items('ol')).toEqual(['Write', 'Come by']);
  });

  it('draws a quote', () => {
    const host = draw([RichText.quote([plain('Show us your work.')])]);
    expect(host.querySelector('blockquote')?.textContent).toBe(
      'Show us your work.',
    );
  });

  it('draws a web link that opens beside the site, and a site path or a mail that does not', () => {
    const host = draw([
      RichText.paragraph([
        RichText.span('work', RichSpanStyle.Bold, 'https://x.example/work'),
        RichText.span('courses', RichSpanStyle.Plain, '/courses'),
        RichText.span('mail', RichSpanStyle.Plain, 'mailto:a@x.example'),
      ]),
    ]);
    const [web, path, mail] = Array.from(host.querySelectorAll('a'));
    expect(web?.getAttribute('href')).toBe('https://x.example/work');
    expect(web?.getAttribute('target')).toBe('_blank');
    expect(web?.getAttribute('rel')).toBe('noopener noreferrer');
    expect(web?.classList.contains('ui-rich-text__run--bold')).toBe(true);
    expect(path?.getAttribute('href')).toBe('/courses');
    expect(path?.hasAttribute('target')).toBe(false);
    expect(mail?.getAttribute('href')).toBe('mailto:a@x.example');
    expect(mail?.hasAttribute('target')).toBe(false);
  });

  it('prints markup in a run as text, never as elements', () => {
    const host = draw([
      RichText.paragraph([plain('<img src=x onerror=alert(1)><b>x</b>')]),
    ]);
    expect(host.querySelector('img, b')).toBeNull();
    expect(host.textContent).toContain('<img src=x onerror=alert(1)><b>x</b>');
  });

  it('draws no picture without a source, or while the source has no address', () => {
    const blocks = [RichText.image(ProgramImageId.of('pic-1'), 'The chair')];
    expect(draw(blocks).querySelector('img')).toBeNull();

    fixture.componentInstance.source.set(() => null);
    fixture.detectChanges();
    expect(draw(blocks).querySelector('img')).toBeNull();
  });

  it('draws a picture from the address its source answers, with its alt text', () => {
    fixture.componentInstance.source.set((id) => `/media/${id}.webp`);
    const image = draw([
      RichText.image(ProgramImageId.of('pic-1'), 'The chair'),
    ]).querySelector('img');
    expect(image?.getAttribute('src')).toBe('/media/pic-1.webp');
    expect(image?.getAttribute('alt')).toBe('The chair');
  });

  it('follows its blocks when they change', () => {
    draw([RichText.paragraph([plain('One')])]);
    const host = draw([RichText.heading(1, [plain('Two')])]);
    expect(host.querySelector('p.ui-rich-text__paragraph')).toBeNull();
    expect(host.textContent?.trim()).toBe('Two');
  });
});
