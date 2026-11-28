import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import {
  UiRichTextEditor,
  type UiRichTextEditorWords,
} from './rich-text-editor';
import { ProgramImageId } from '@core/primitives';
import type { UiRichImageUpload } from './rich-text-editor.model';

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
  image: 'Picture',
  imageAlt: 'Picture description',
  imageAltPlaceholder: 'What the picture shows',
  imageRemove: 'Remove the picture',
};

@Component({
  imports: [UiRichTextEditor],
  template: `<ui-rich-text-editor
    [uiMarkdown]="markdown()"
    [uiWords]="words"
    [uiMaxChars]="max()"
    [uiDisabled]="disabled()"
    [uiImageUpload]="upload()"
    [uiImageSource]="source()"
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
  uploaded: File[] = [];
  /** What the next upload answers. */
  next: UiRichImageUpload = {
    imageId: ProgramImageId.of('act-0123_1600x900'),
    refusal: null,
  };
  upload = signal<((file: File) => Promise<UiRichImageUpload>) | null>(null);
  source = signal<((imageId: string) => string | null) | null>(null);

  takeUploads(): void {
    this.upload.set(async (file) => {
      this.uploaded.push(file);
      return this.next;
    });
  }
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

  describe('pictures', () => {
    const PNG = new File(['x'], 'chair.png', { type: 'image/png' });

    /** Picks files in the toolbar's hidden picker. */
    function pick(files: readonly File[]): void {
      const picker = host.querySelector(
        '[data-testid="rich-image-file"]',
      ) as HTMLInputElement;
      Object.defineProperty(picker, 'files', {
        value: files,
        configurable: true,
      });
      picker.dispatchEvent(new Event('change'));
    }

    async function settled(check: () => void): Promise<void> {
      await vi.waitFor(() => {
        fixture.detectChanges();
        check();
      });
    }

    it('has no picture button until the host can take a picture', async () => {
      await ready('');
      expect(tool('image')).toBeNull();

      fixture.componentInstance.takeUploads();
      fixture.detectChanges();
      expect(tool('image').getAttribute('aria-label')).toBe('Picture');
    });

    it('uploads a picked file and names the picture in the text', async () => {
      await ready('Words');
      fixture.componentInstance.takeUploads();
      fixture.componentInstance.source.set((id) => `/media/${id}`);
      fixture.detectChanges();

      pick([PNG]);

      await settled(() =>
        expect(lastAnswer()).toContain('![](act-0123_1600x900)'),
      );
      expect(fixture.componentInstance.uploaded).toEqual([PNG]);
      const frame = content().querySelector<HTMLElement>(
        '.ui-rich-text-editor__image',
      );
      expect(frame?.style.aspectRatio).toBe('1600 / 900');
      expect(frame?.querySelector('img')?.getAttribute('src')).toBe(
        '/media/act-0123_1600x900',
      );
    });

    it('puts a picture after the selection — never over it, and never inside a list item', async () => {
      await ready('- Fades\n- Beards');
      fixture.componentInstance.takeUploads();
      fixture.detectChanges();
      selectAll();

      pick([PNG]);

      await settled(() =>
        expect(lastAnswer()).toContain('![](act-0123_1600x900)'),
      );
      expect(lastAnswer()).toContain('- Fades\n- Beards');
      expect(
        content().querySelector('li .ui-rich-text-editor__image'),
      ).toBeNull();
    });

    it('holds a stored picture’s place, and draws it when its address arrives', async () => {
      await ready('![The chair](act-0123_1600x900)');
      const frame = content().querySelector<HTMLElement>(
        '.ui-rich-text-editor__image',
      );
      expect(frame?.hasAttribute('data-pending')).toBe(true);
      expect(frame?.querySelector('img')?.getAttribute('alt')).toBe(
        'The chair',
      );

      fixture.componentInstance.source.set((id) => `/media/${id}`);
      fixture.detectChanges();

      expect(frame?.hasAttribute('data-pending')).toBe(false);
      expect(frame?.querySelector('img')?.getAttribute('src')).toBe(
        '/media/act-0123_1600x900',
      );
    });

    it('says why a picture did not land, in the host’s words, and adds nothing', async () => {
      await ready('Words');
      fixture.componentInstance.takeUploads();
      fixture.componentInstance.next = {
        imageId: null,
        refusal: 'This picture cannot be used.',
      };
      fixture.detectChanges();

      pick([PNG]);

      await settled(() =>
        expect(
          host.querySelector('[data-testid="rich-image-refusal"]')?.textContent,
        ).toContain('This picture cannot be used.'),
      );
      expect(content().querySelector('.ui-rich-text-editor__image')).toBeNull();
      expect(lastAnswer()).toBeUndefined();
    });

    it('takes a pasted picture file, and never the clipboard’s markup', async () => {
      await ready('');
      fixture.componentInstance.takeUploads();
      fixture.detectChanges();
      const paste = new Event('paste', { bubbles: true, cancelable: true });
      Object.defineProperty(paste, 'clipboardData', {
        value: { files: [PNG], getData: () => '<img src=x onerror=x()>' },
      });

      content().dispatchEvent(paste);

      await settled(() => expect(lastAnswer()).toBe('![](act-0123_1600x900)'));
      expect(paste.defaultPrevented).toBe(true);
      expect(fixture.componentInstance.uploaded).toEqual([PNG]);
    });

    it('describes and removes the selected picture', async () => {
      await ready('Words');
      fixture.componentInstance.takeUploads();
      fixture.detectChanges();
      pick([PNG]);
      // A picture just put in is the selection: its row is open.
      await settled(() =>
        expect(
          host.querySelector('[data-testid="rich-image-alt"]'),
        ).not.toBeNull(),
      );

      const alt = host.querySelector(
        '[data-testid="rich-image-alt"]',
      ) as HTMLInputElement;
      alt.value = 'The chair';
      alt.dispatchEvent(new Event('input'));
      fixture.detectChanges();
      expect(lastAnswer()).toContain('![The chair](act-0123_1600x900)');

      press(
        host.querySelector('[data-testid="rich-image-remove"]') as HTMLElement,
      );
      expect(lastAnswer()).toBe('Words');
      expect(host.querySelector('[data-testid="rich-image-alt"]')).toBeNull();
    });
  });

  it('locks the tools and the text while disabled', async () => {
    await ready('Fades');

    fixture.componentInstance.disabled.set(true);
    fixture.detectChanges();

    expect(tool('bold').disabled).toBe(true);
    expect(content().getAttribute('contenteditable')).toBe('false');
  });
});
