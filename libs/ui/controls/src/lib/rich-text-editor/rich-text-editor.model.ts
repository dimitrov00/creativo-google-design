import type { RichText } from '@core/components';
import type { ProgramImageId } from '@core/primitives';

/*
 * WHAT THE ELEMENT AND ITS ENGINE SAY TO EACH OTHER — plain types and one
 * dictionary, so the element can name a command and read the toolbar's
 * state without importing the editor library (which loads on demand).
 */

/** What a toolbar button asks the editor to do — the only source of these strings. */
export const UiRichCommand = {
  Paragraph: 'PARAGRAPH',
  Heading1: 'HEADING_1',
  Heading2: 'HEADING_2',
  Bold: 'BOLD',
  Italic: 'ITALIC',
  BulletList: 'BULLET_LIST',
  OrderedList: 'ORDERED_LIST',
  Quote: 'QUOTE',
  Undo: 'UNDO',
  Redo: 'REDO',
} as const;
export type UiRichCommand = (typeof UiRichCommand)[keyof typeof UiRichCommand];

/** What the toolbar shows about where the caret is. */
export type UiRichEditorState = {
  readonly paragraph: boolean;
  readonly heading1: boolean;
  readonly heading2: boolean;
  readonly bold: boolean;
  readonly italic: boolean;
  readonly bulletList: boolean;
  readonly orderedList: boolean;
  readonly quote: boolean;
  /** The address of the link under the caret; `null` outside one. */
  readonly link: string | null;
  /** Some words are selected (a link can be put on them). */
  readonly hasSelection: boolean;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  /** The description of the picture that is selected; `null` when none is. */
  readonly imageAlt: string | null;
};

/** Turns a picture's id into its address; `null` while it has none. */
export type UiRichImageSource = (imageId: string) => string | null;

/**
 * What an upload answers: the id the text names the picture by, or — when
 * it did not land — the words that say why.
 */
export type UiRichImageUpload = {
  readonly imageId: ProgramImageId | null;
  readonly refusal: string | null;
};

/** The toolbar before the editor has answered: nothing on, nothing to undo. */
export const UI_RICH_EDITOR_IDLE: UiRichEditorState = {
  paragraph: false,
  heading1: false,
  heading2: false,
  bold: false,
  italic: false,
  bulletList: false,
  orderedList: false,
  quote: false,
  link: null,
  hasSelection: false,
  canUndo: false,
  canRedo: false,
  imageAlt: null,
};

/** What the engine is made from. */
export type UiRichEngineOptions = {
  /** The element the editor mounts in. */
  readonly element: HTMLElement;
  readonly blocks: RichText;
  readonly placeholder: string;
  /** The editing surface's accessible name. */
  readonly label: string;
  /** The heading level the body's first level takes (as `ui-rich-text`). */
  readonly headingLevel: number;
  readonly editable: boolean;
  /** The words changed: read {@link UiRichEngine.blocks}. */
  readonly onChange: () => void;
  /** The caret moved or the words changed: the toolbar's new state. */
  readonly onState: (state: UiRichEditorState) => void;
  readonly onFocus: (focused: boolean) => void;
  /** A picture's address, asked whenever one is drawn. */
  readonly imageSource: UiRichImageSource;
  /** Picture files were pasted or dropped in; the caret is where they go. */
  readonly onFiles: (files: readonly File[]) => void;
};

/** The running editor, as the element drives it. */
export type UiRichEngine = {
  blocks(): RichText;
  /** Replaces the whole document, without telling `onChange` and without an undo step. */
  setBlocks(blocks: RichText): void;
  run(command: UiRichCommand): void;
  /** Puts a link on the selection (or the link under the caret); `null` takes it off. */
  setLink(href: string | null): void;
  /** Puts a picture where the caret is. */
  insertImage(imageId: ProgramImageId): void;
  /** Rewrites the selected picture's description. */
  setImageAlt(imageAlt: string): void;
  /** Takes the selected picture out of the text. */
  removeImage(): void;
  /** The addresses changed: every picture drawn asks for its own again. */
  refreshImages(): void;
  setEditable(editable: boolean): void;
  focus(): void;
  destroy(): void;
};
