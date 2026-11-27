import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  Injector,
  ViewEncapsulation,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { RichText } from '@core/components';
import { RichTextSystem } from '@core/systems';
import { UiIcon, type UiIconName } from '@creativo/ui/icons';
import { UiButton } from '../button/button';
import { UiTextField } from '../text-field/text-field';
import {
  UI_RICH_EDITOR_IDLE,
  UiRichCommand,
  type UiRichEditorState,
  type UiRichEngine,
} from './rich-text-editor.model';

/** The words the editor prints and reads out — the host's, in its language. */
export type UiRichTextEditorWords = {
  /** The toolbar's accessible name: «Форматиране». */
  readonly toolbar: string;
  readonly paragraph: string;
  readonly heading1: string;
  readonly heading2: string;
  readonly bold: string;
  readonly italic: string;
  readonly bulletList: string;
  readonly orderedList: string;
  readonly quote: string;
  readonly link: string;
  readonly undo: string;
  readonly redo: string;
  /** The address field's name and its hint: «Адрес на връзката», «creativo.bg или имейл». */
  readonly linkAddress: string;
  readonly linkPlaceholder: string;
  /** The address field's answers: «Готово», «Премахни връзката». */
  readonly linkApply: string;
  readonly linkRemove: string;
  /** Said under the address field when what was typed is no address. */
  readonly linkInvalid: string;
};

/** One toolbar button: what it asks, what it shows, and when it is on. */
type Tool = {
  readonly command: UiRichCommand;
  readonly icon: UiIconName;
  readonly label: keyof UiRichTextEditorWords;
  readonly on: keyof UiRichEditorState | null;
  /** Names the button in test ids: `rich-tool-<id>`. */
  readonly id: string;
};

/** The toolbar, group by group: what a block is, how a run is set, the lists and the quote. */
const TOOL_GROUPS: readonly (readonly Tool[])[] = [
  [
    {
      command: UiRichCommand.Heading1,
      icon: 'richText.heading1',
      label: 'heading1',
      on: 'heading1',
      id: 'heading1',
    },
    {
      command: UiRichCommand.Heading2,
      icon: 'richText.heading2',
      label: 'heading2',
      on: 'heading2',
      id: 'heading2',
    },
  ],
  [
    {
      command: UiRichCommand.Bold,
      icon: 'richText.bold',
      label: 'bold',
      on: 'bold',
      id: 'bold',
    },
    {
      command: UiRichCommand.Italic,
      icon: 'richText.italic',
      label: 'italic',
      on: 'italic',
      id: 'italic',
    },
  ],
  [
    {
      command: UiRichCommand.BulletList,
      icon: 'richText.bulletList',
      label: 'bulletList',
      on: 'bulletList',
      id: 'bullet-list',
    },
    {
      command: UiRichCommand.OrderedList,
      icon: 'richText.orderedList',
      label: 'orderedList',
      on: 'orderedList',
      id: 'ordered-list',
    },
    {
      command: UiRichCommand.Quote,
      icon: 'richText.quote',
      label: 'quote',
      on: 'quote',
      id: 'quote',
    },
  ],
];

const HISTORY: readonly Tool[] = [
  {
    command: UiRichCommand.Undo,
    icon: 'richText.undo',
    label: 'undo',
    on: null,
    id: 'undo',
  },
  {
    command: UiRichCommand.Redo,
    icon: 'richText.redo',
    label: 'redo',
    on: null,
    id: 'redo',
  },
];

/**
 * The rich text editor — where staff write a description: headings, bold
 * and italic, bulleted and numbered lists, quotes and links, set with a
 * toolbar and shown as the page will show them (the editing surface wears
 * `ui-rich-text`'s own type). It reads and answers MARKDOWN — the subset
 * `RichTextSystem` parses — so what is typed is what is stored.
 *
 * The toolbar stays in view while a long text scrolls under it; a button
 * is lit while the caret is in what it sets. The link button opens an
 * address row: a web address, an e-mail, a phone number or a site path is
 * taken, anything else is said to be no address. Typing Markdown works too
 * (`# `, `- `, `1. `, `> `, `**bold**`). A paste from outside comes in as
 * plain text; what was copied inside the editor keeps its formatting.
 *
 * The editor library (Tiptap) is fetched when the element is first drawn,
 * never with the page that hosts it. Until it answers the surface is an
 * empty field of the same size.
 *
 * Markup contract:
 * ```html
 * <ui-rich-text-editor
 *   [uiMarkdown]="body()"
 *   [uiWords]="words"
 *   uiLabel="Описание"
 *   uiPlaceholder="Разкажи за ролята…"
 *   (uiMarkdownChange)="body.set($event)"
 * />
 * ```
 *
 * @uiPurpose The editor a description is written in: headings, bold,
 *   italic, lists, quotes and links from a toolbar, read and answered as
 *   Markdown.
 * @uiSwiftUI `TextEditor` over an `AttributedString`, with a formatting toolbar
 * @uiAliases rich text editor, wysiwyg, markdown editor, text editor,
 *   formatting toolbar, content editor, tiptap, prosemirror
 * @uiNotThis A few plain lines are `textarea[uiTextField]`; a description
 *   only shown is `ui-rich-text`.
 */
@Component({
  selector: 'ui-rich-text-editor',
  imports: [UiButton, UiIcon, UiTextField],
  template: `
    <div class="ui-rich-text-editor__head">
      <div
        class="ui-rich-text-editor__bar"
        role="toolbar"
        [attr.aria-label]="uiWords().toolbar"
      >
        <div class="ui-rich-text-editor__tools">
          @for (group of groups; track $index) {
            <div class="ui-rich-text-editor__group">
              @for (tool of group; track tool.id) {
                <button
                  type="button"
                  uiButton
                  uiButtonStyle="plain"
                  uiControlSize="small"
                  uiButtonBorderShape="roundedRectangle"
                  [uiIconOnly]="true"
                  [uiSelected]="lit(tool)"
                  [disabled]="!ready() || uiDisabled()"
                  [attr.aria-label]="uiWords()[tool.label]"
                  [attr.title]="uiWords()[tool.label]"
                  [attr.data-testid]="'rich-tool-' + tool.id"
                  (mousedown)="$event.preventDefault()"
                  (click)="run(tool.command)"
                >
                  <ui-icon [uiName]="tool.icon" aria-hidden="true" />
                </button>
              }
            </div>
          }
          <div class="ui-rich-text-editor__group">
            <button
              type="button"
              uiButton
              uiButtonStyle="plain"
              uiControlSize="small"
              uiButtonBorderShape="roundedRectangle"
              [uiIconOnly]="true"
              [uiSelected]="linkOpen() || state().link !== null"
              [disabled]="!ready() || uiDisabled()"
              [attr.aria-label]="uiWords().link"
              [attr.title]="uiWords().link"
              [attr.aria-expanded]="linkOpen()"
              data-testid="rich-tool-link"
              (mousedown)="$event.preventDefault()"
              (click)="toggleLink()"
            >
              <ui-icon uiName="richText.link" aria-hidden="true" />
            </button>
          </div>
        </div>
        <div class="ui-rich-text-editor__group ui-rich-text-editor__history">
          @for (tool of history; track tool.id) {
            <button
              type="button"
              uiButton
              uiButtonStyle="plain"
              uiControlSize="small"
              uiButtonBorderShape="roundedRectangle"
              [uiIconOnly]="true"
              [disabled]="!canRun(tool) || uiDisabled()"
              [attr.aria-label]="uiWords()[tool.label]"
              [attr.title]="uiWords()[tool.label]"
              [attr.data-testid]="'rich-tool-' + tool.id"
              (mousedown)="$event.preventDefault()"
              (click)="run(tool.command)"
            >
              <ui-icon [uiName]="tool.icon" aria-hidden="true" />
            </button>
          }
        </div>
      </div>
      @if (linkOpen()) {
        <form
          class="ui-rich-text-editor__link"
          novalidate
          data-testid="rich-link"
          (submit)="applyLink($event)"
          (keydown.escape)="closeLink()"
        >
          <input
            #linkField
            uiTextField
            uiControlSize="small"
            type="text"
            inputmode="url"
            autocapitalize="off"
            autocomplete="off"
            spellcheck="false"
            [attr.aria-label]="uiWords().linkAddress"
            [attr.aria-invalid]="linkRefused() ? 'true' : null"
            [attr.data-invalid]="linkRefused() ? '' : null"
            [placeholder]="uiWords().linkPlaceholder"
            [value]="linkDraft()"
            data-testid="rich-link-address"
            (input)="typeLink($event)"
          />
          @if (state().link !== null) {
            <button
              type="button"
              uiButton
              uiButtonStyle="plain"
              uiControlSize="small"
              [uiIconOnly]="true"
              [attr.aria-label]="uiWords().linkRemove"
              [attr.title]="uiWords().linkRemove"
              data-testid="rich-link-remove"
              (click)="removeLink()"
            >
              <ui-icon uiName="richText.unlink" aria-hidden="true" />
            </button>
          }
          <button
            type="submit"
            uiButton
            uiButtonStyle="bordered"
            uiControlSize="small"
            data-testid="rich-link-apply"
          >
            {{ uiWords().linkApply }}
          </button>
          @if (linkRefused()) {
            <p class="ui-rich-text-editor__refusal" role="alert">
              {{ uiWords().linkInvalid }}
            </p>
          }
        </form>
      }
    </div>
    <div
      #surface
      class="ui-rich-text-editor__surface"
      data-testid="rich-surface"
    ></div>
    <div class="ui-rich-text-editor__foot">
      <span
        class="ui-rich-text-editor__count"
        [attr.data-over]="over() ? '' : null"
        data-testid="rich-count"
        >{{ count() }} / {{ uiMaxChars() }}</span
      >
    </div>
  `,
  // The text is set in `ui-rich-text`'s own rules — the one stylesheet, so
  // what is typed looks as the page will draw it — beside the editor's own.
  styleUrls: [
    '../../../../patterns/src/lib/rich-text/rich-text.css',
    './rich-text-editor.css',
  ],
  host: {
    class: 'ui-rich-text-editor',
    tabindex: '-1',
    '[attr.data-ready]': "ready() ? '' : null",
    '[attr.data-focused]': "focused() ? '' : null",
    '[attr.data-invalid]': "uiInvalid() || over() ? '' : null",
    '[attr.data-disabled]': "uiDisabled() ? '' : null",
    '(focus)': 'focus()',
    '(click)': 'focusFromSurface($event)',
  },
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Unscoped: the editor draws its own elements inside the surface, and
  // bare `.ui-*` selectors are the system's styling contract (§3.1).
  encapsulation: ViewEncapsulation.None,
})
export class UiRichTextEditor {
  /** The description, as the Markdown subset `RichTextSystem` reads. */
  readonly uiMarkdown = input('');
  /** The words the toolbar and the address row print and read out. */
  readonly uiWords = input.required<UiRichTextEditorWords>();
  /** The editing surface's accessible name. */
  readonly uiLabel = input.required<string>();
  /** Shown while nothing is typed. */
  readonly uiPlaceholder = input('');
  /** The heading level the body's first level takes (as `ui-rich-text`). */
  readonly uiHeadingLevel = input(2);
  /** The most characters the Markdown may hold; the counter says how many are used. */
  readonly uiMaxChars = input<number>(RichText.BODY_MAX_CHARS);
  /** Marks the field as owing something. */
  readonly uiInvalid = input(false);
  readonly uiDisabled = input(false);
  /** The words changed: the description as Markdown. */
  readonly uiMarkdownChange = output<string>();

  protected readonly groups = TOOL_GROUPS;
  protected readonly history = HISTORY;
  protected readonly state = signal<UiRichEditorState>(UI_RICH_EDITOR_IDLE);
  protected readonly ready = signal(false);
  protected readonly focused = signal(false);
  protected readonly linkOpen = signal(false);
  protected readonly linkDraft = signal('');
  protected readonly linkRefused = signal(false);
  /** The Markdown's length, as last written or handed in. */
  protected readonly count = signal(0);
  protected readonly over = computed(() => this.count() > this.uiMaxChars());

  private readonly surface =
    viewChild.required<ElementRef<HTMLElement>>('surface');
  private readonly linkField = viewChild('linkField', {
    read: ElementRef<HTMLInputElement>,
  });
  private readonly injector = inject(Injector);
  private engine: UiRichEngine | null = null;
  /** What the editor last answered — handed back in, it is not a new text. */
  private answered: string | null = null;
  private destroyed = false;

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      this.destroyed = true;
      this.engine?.destroy();
      this.engine = null;
    });

    afterNextRender(() => void this.mount());

    // A text handed in from outside (another language, a loaded body)
    // replaces the document; the editor's own answer coming back does not.
    effect(() => {
      const markdown = this.uiMarkdown();
      untracked(() => {
        this.count.set(markdown.length);
        if (markdown === this.answered) return;
        this.answered = markdown;
        this.engine?.setBlocks(RichTextSystem.parse(markdown));
      });
    });

    effect(() => {
      const disabled = this.uiDisabled();
      untracked(() => this.engine?.setEditable(!disabled));
    });
  }

  /** Puts the caret in the text. */
  focus(): void {
    this.engine?.focus();
  }

  private async mount(): Promise<void> {
    const { createRichTextEngine } = await import('./rich-text-editor.engine');
    if (this.destroyed) return;
    const markdown = untracked(this.uiMarkdown);
    this.answered = markdown;
    this.engine = createRichTextEngine({
      element: this.surface().nativeElement,
      blocks: RichTextSystem.parse(markdown),
      placeholder: untracked(this.uiPlaceholder),
      label: untracked(this.uiLabel),
      headingLevel: untracked(this.uiHeadingLevel),
      editable: !untracked(this.uiDisabled),
      onChange: () => this.answer(),
      onState: (state) => this.state.set(state),
      onFocus: (focused) => this.focused.set(focused),
    });
    this.ready.set(true);
  }

  /** The editor's words changed: they are written as Markdown and handed out. */
  private answer(): void {
    if (this.engine === null) return;
    const markdown = RichTextSystem.write(this.engine.blocks());
    if (markdown === this.answered) return;
    this.answered = markdown;
    this.count.set(markdown.length);
    this.uiMarkdownChange.emit(markdown);
  }

  protected lit(tool: Tool): boolean {
    return tool.on !== null && this.state()[tool.on] === true;
  }

  protected canRun(tool: Tool): boolean {
    if (!this.ready()) return false;
    if (tool.command === UiRichCommand.Undo) return this.state().canUndo;
    if (tool.command === UiRichCommand.Redo) return this.state().canRedo;
    return true;
  }

  protected run(command: UiRichCommand): void {
    this.engine?.run(command);
  }

  /** A press on the field around the text puts the caret in the text. */
  protected focusFromSurface(event: Event): void {
    if (event.target === this.surface().nativeElement) this.engine?.focus();
  }

  protected toggleLink(): void {
    if (this.linkOpen()) {
      this.closeLink();
      return;
    }
    this.linkDraft.set(this.state().link ?? '');
    this.linkRefused.set(false);
    this.linkOpen.set(true);
    afterNextRender(() => this.linkField()?.nativeElement.focus(), {
      injector: this.injector,
    });
  }

  protected typeLink(event: Event): void {
    this.linkDraft.set((event.target as HTMLInputElement).value);
    this.linkRefused.set(false);
  }

  protected applyLink(event: Event): void {
    event.preventDefault();
    const href = RichTextSystem.linkHref(this.linkDraft());
    if (href === null) {
      this.linkRefused.set(true);
      return;
    }
    this.engine?.setLink(href);
    this.linkOpen.set(false);
  }

  protected removeLink(): void {
    this.engine?.setLink(null);
    this.linkOpen.set(false);
  }

  protected closeLink(): void {
    this.linkOpen.set(false);
    this.engine?.focus();
  }
}
