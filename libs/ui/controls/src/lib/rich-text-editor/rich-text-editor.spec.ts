import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import {
  UiRichTextEditor,
  type UiRichTextEditorWords,
} from './rich-text-editor';

const WORDS: UiRichTextEditorWords = {
  toolbar: 'Formatting',
  paragraph: 'Text',
  heading1: 'Heading',
  heading2: 'Subheading',
  bold: 'Bold',
  italic: 'Italic',
  bulletList: 'Bulleted list',
  orderedList: 'Numbered list',
  quote: 'Quote',
  link: 'Link',
  undo: 'Undo',
  redo: 'Redo',
  linkAddress: 'Link address',
  linkPlaceholder: 'creativo.example',
  linkApply: 'Done',
  linkRemove: 'Remove link',
  linkInvalid: 'That is not an address.',
};

@Component({
  imports: [UiRichTextEditor],
  template: `<ui-rich-text-editor
    [uiMarkdown]="markdown()"
    [uiWords]="words"
    [uiMaxChars]="max()"
    [uiDisabled]="disabled()"
    uiLabel="Description"
    uiPlaceholder="Tell the story"
    (uiMarkdownChange)="answers.push($event); markdown.set($event)"
  />`,
})
class HostComponent {
  words = WORDS;
  markdown = signal('');
  max = signal(20_000);
  disabled = signal(false);
  answers: string[] = [];
}

describe('UiRichTextEditor', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HTMLElement;

  /** The editor library is fetched on demand: wait until the surface holds it. */
  async function ready(markdown = ''): Promise<void> {
    await TestBed.configureTestingModule({
      imports: [HostComponent],
    }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
    fixture.componentInstance.markdown.set(markdown);
    fixture.detectChanges();
    host = fixture.nativeElement.querySelector('ui-rich-text-editor');
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(host.hasAttribute('data-ready')).toBe(true);
    });
  }

  const content = (): HTMLElement =>
    host.querySelector('.ui-rich-text-editor__content') as HTMLElement;
  const tool = (id: string): HTMLButtonElement =>
    host.querySelector(`[data-testid="rich-tool-${id}"]`) as HTMLButtonElement;
  const lastAnswer = (): string | undefined =>
    fixture.componentInstance.answers.at(-1);

  /** Selects every word of the text: Ctrl+A in the editor. */
  function selectAll(): void {
    content().dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'a',
        code: 'KeyA',
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    fixture.detectChanges();
  }

  function press(button: HTMLElement): void {
    button.click();
    fixture.detectChanges();
  }

  it('draws a stored description as the page will: its blocks in the system’s own classes', async () => {
    await ready(
      '# What you do\n\nA **chair** in [Center](/locations).\n\n- Fades\n- Beards\n\n> Show us.',
    );

    const surface = content();
    expect(surface.classList.contains('ui-rich-text')).toBe(true);
    expect(surface.getAttribute('role')).toBe('textbox');
    expect(surface.getAttribute('aria-label')).toBe('Description');
    const heading = surface.querySelector('[role="heading"]');
    expect(heading?.textContent).toBe('What you do');
    expect(heading?.getAttribute('aria-level')).toBe('2');
    expect(surface.querySelector('strong')?.textContent).toBe('chair');
    expect(surface.querySelector('a')?.getAttribute('href')).toBe('/locations');
    expect(
      Array.from(surface.querySelectorAll('ul > li'), (li) => li.textContent),
    ).toEqual(['Fades', 'Beards']);
    expect(surface.querySelector('blockquote')?.textContent).toBe('Show us.');
    // Opening a description is not an edit.
    expect(fixture.componentInstance.answers).toEqual([]);
  });

  it('names every tool for a reader, in a toolbar', async () => {
    await ready();

    const bar = host.querySelector('[role="toolbar"]');
    expect(bar?.getAttribute('aria-label')).toBe('Formatting');
    expect(
      Array.from(bar?.querySelectorAll('button') ?? [], (button) =>
        button.getAttribute('aria-label'),
      ),
    ).toEqual([
      'Heading',
      'Subheading',
      'Bold',
      'Italic',
      'Bulleted list',
      'Numbered list',
      'Quote',
      'Link',
      'Undo',
      'Redo',
    ]);
  });

  it('answers Markdown when a tool sets the chosen words, and lights the tool', async () => {
    await ready('Fades and beards');
    selectAll();

    press(tool('bold'));

    expect(lastAnswer()).toBe('**Fades and beards**');
    expect(tool('bold').getAttribute('aria-pressed')).toBe('true');

    press(tool('heading1'));
    expect(lastAnswer()).toBe('# **Fades and beards**');
    expect(tool('heading1').getAttribute('aria-pressed')).toBe('true');

    press(tool('bullet-list'));
    expect(lastAnswer()).toBe('- **Fades and beards**');
  });

  it('undoes and redoes, and offers neither before anything was done', async () => {
    await ready('Fades');
    expect(tool('undo').disabled).toBe(true);
    expect(tool('redo').disabled).toBe(true);
    selectAll();
    press(tool('italic'));
    expect(lastAnswer()).toBe('*Fades*');

    press(tool('undo'));
    expect(lastAnswer()).toBe('Fades');
    expect(tool('redo').disabled).toBe(false);

    press(tool('redo'));
    expect(lastAnswer()).toBe('*Fades*');
  });

  it('puts a link on the chosen words from the address row, reading what was typed as an address', async () => {
    await ready('our courses');
    selectAll();
    press(tool('link'));

    const address = host.querySelector(
      '[data-testid="rich-link-address"]',
    ) as HTMLInputElement;
    address.value = 'creativo.example/courses';
    address.dispatchEvent(new Event('input'));
    (
      host.querySelector('[data-testid="rich-link"]') as HTMLFormElement
    ).dispatchEvent(new Event('submit', { cancelable: true }));
    fixture.detectChanges();

    expect(lastAnswer()).toBe(
      '[our courses](https://creativo.example/courses)',
    );
    expect(host.querySelector('[data-testid="rich-link"]')).toBeNull();
  });

  it('says so when what was typed is no address, and changes nothing', async () => {
    await ready('our courses');
    selectAll();
    press(tool('link'));

    const address = host.querySelector(
      '[data-testid="rich-link-address"]',
    ) as HTMLInputElement;
    address.value = 'javascript:alert(1)';
    address.dispatchEvent(new Event('input'));
    (
      host.querySelector('[data-testid="rich-link"]') as HTMLFormElement
    ).dispatchEvent(new Event('submit', { cancelable: true }));
    fixture.detectChanges();

    expect(host.querySelector('[role="alert"]')?.textContent?.trim()).toBe(
      'That is not an address.',
    );
    expect(address.getAttribute('aria-invalid')).toBe('true');
    expect(fixture.componentInstance.answers).toEqual([]);
  });

  it('takes a text handed in from outside, and does not answer it back', async () => {
    await ready('Български текст');

    fixture.componentInstance.markdown.set('## English text');
    fixture.detectChanges();

    expect(content().querySelector('[role="heading"]')?.textContent).toBe(
      'English text',
    );
    expect(fixture.componentInstance.answers).toEqual([]);
  });

  it('counts the Markdown against the limit and marks the field when it is over', async () => {
    await ready('Fades');
    const count = host.querySelector('[data-testid="rich-count"]');
    expect(count?.textContent?.replace(/\s+/g, ' ').trim()).toBe('5 / 20000');
    expect(host.hasAttribute('data-invalid')).toBe(false);

    fixture.componentInstance.max.set(4);
    fixture.detectChanges();

    expect(count?.hasAttribute('data-over')).toBe(true);
    expect(host.hasAttribute('data-invalid')).toBe(true);
  });

  it('pastes from outside as plain text, never as markup', async () => {
    await ready('');
    const paste = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(paste, 'clipboardData', {
      value: {
        getData: (kind: string) =>
          kind === 'text/plain'
            ? 'Plain words'
            : '<b onclick="x()">Plain</b> <img src=x onerror=alert(1)> words',
      },
    });

    content().dispatchEvent(paste);
    fixture.detectChanges();

    expect(paste.defaultPrevented).toBe(true);
    expect(lastAnswer()).toBe('Plain words');
    expect(content().querySelector('b, img')).toBeNull();
  });

  it('locks the tools and the text while disabled', async () => {
    await ready('Fades');

    fixture.componentInstance.disabled.set(true);
    fixture.detectChanges();

    expect(tool('bold').disabled).toBe(true);
    expect(content().getAttribute('contenteditable')).toBe('false');
  });
});
