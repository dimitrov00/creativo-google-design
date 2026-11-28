import { Editor, Node, mergeAttributes, type JSONContent } from '@tiptap/core';
import { Blockquote } from '@tiptap/extension-blockquote';
import { Bold } from '@tiptap/extension-bold';
import { Document } from '@tiptap/extension-document';
import { HardBreak } from '@tiptap/extension-hard-break';
import { Heading } from '@tiptap/extension-heading';
import { Italic } from '@tiptap/extension-italic';
import { Link } from '@tiptap/extension-link';
import {
  BulletList,
  ListItem,
  ListKeymap,
  OrderedList,
} from '@tiptap/extension-list';
import { Paragraph } from '@tiptap/extension-paragraph';
import { Text } from '@tiptap/extension-text';
import { Dropcursor, Placeholder, UndoRedo } from '@tiptap/extensions';
import type { Slice } from '@tiptap/pm/model';
import { EditorState, NodeSelection } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import { RichText } from '@core/components';
import { ProgramImageId } from '@core/primitives';
import { RichTextSystem } from '@core/systems';
import {
  UiRichMarkName,
  UiRichNodeName,
  blocksOf,
  documentOf,
  type UiRichNode,
} from './rich-text-document';
import {
  UiRichCommand,
  type UiRichEditorState,
  type UiRichEngine,
  type UiRichEngineOptions,
  type UiRichImageSource,
} from './rich-text-editor.model';

/*
 * THE ENGINE — Tiptap (ProseMirror) set up for exactly the subset a
 * description may hold, in its own module so it is fetched only when an
 * editor is drawn (`rich-text-editor.ts` imports it on demand).
 *
 * NO HTML STRING EVER REACHES THE PAGE. The site's security header forbids
 * it (`require-trusted-types-for 'script'`), and the three places the
 * library would write one are closed here:
 * - the document comes in and goes out as JSON (`documentOf`, `blocksOf`),
 *   never as an HTML string;
 * - the library's own style tag is off (`injectCSS: false`) — its rules are
 *   in `rich-text-editor.css`;
 * - a paste or a drop from outside is taken as PLAIN TEXT before the
 *   library reads the clipboard's HTML. What was copied inside this editor
 *   is remembered here, so pasting it back keeps its formatting.
 */

/** What was last copied or cut in this editor: the piece itself, and the text the clipboard got. */
type Copied = { readonly slice: Slice; readonly text: string };

/** One picture as it is drawn: its frame, its image, and the id it shows. */
type DrawnImage = {
  readonly frame: HTMLElement;
  readonly image: HTMLImageElement;
  imageId: ProgramImageId;
  imageAlt: string;
};

/** The picture files of a paste or a drop — `[]` when it carries none. */
function imageFilesOf(data: DataTransfer | null): readonly File[] {
  if (data === null) return [];
  const out: File[] = [];
  // A clipboard that carries no files may carry no list of them either.
  for (const file of Array.from(data.files ?? [])) {
    if (file.type.startsWith('image/')) out.push(file);
  }
  return out;
}

/**
 * A picture a body names, drawn as the page draws it: a frame that holds
 * the picture's place (its id carries its size) and the image inside, its
 * address asked of the host. The elements are made one by one — no HTML
 * string — and `drawn` keeps each, so a late address reaches it.
 */
function richImage(source: UiRichImageSource, drawn: Set<DrawnImage>) {
  const draw = (entry: DrawnImage): void => {
    const size = RichText.imageSize(entry.imageId);
    entry.frame.style.aspectRatio =
      size === null ? '' : `${size.pixelWidth} / ${size.pixelHeight}`;
    entry.image.alt = entry.imageAlt;
    const address = source(entry.imageId);
    if (address === null) {
      entry.frame.setAttribute('data-pending', '');
      entry.image.removeAttribute('src');
    } else {
      entry.frame.removeAttribute('data-pending');
      if (entry.image.getAttribute('src') !== address) {
        entry.image.src = address;
      }
    }
  };
  return {
    redraw: (): void => drawn.forEach(draw),
    node: Node.create({
      name: UiRichNodeName.Image,
      group: 'block',
      atom: true,
      selectable: true,
      draggable: true,
      addAttributes() {
        return { imageId: { default: '' }, imageAlt: { default: '' } };
      },
      // What a copy carries: the description, as words.
      renderHTML({ node }) {
        return [
          'div',
          { class: 'ui-rich-text-editor__image' },
          String(node.attrs['imageAlt'] ?? ''),
        ];
      },
      addNodeView() {
        return ({ node }) => {
          const frame = document.createElement('figure');
          frame.className = 'ui-rich-text-editor__image';
          const image = document.createElement('img');
          image.className = 'ui-rich-text__image';
          image.draggable = false;
          image.decoding = 'async';
          frame.append(image);
          const entry: DrawnImage = {
            frame,
            image,
            imageId: ProgramImageId.of(String(node.attrs['imageId'] ?? '')),
            imageAlt: String(node.attrs['imageAlt'] ?? ''),
          };
          drawn.add(entry);
          draw(entry);
          return {
            dom: frame,
            update(next) {
              if (next.type.name !== UiRichNodeName.Image) return false;
              entry.imageId = ProgramImageId.of(
                String(next.attrs['imageId'] ?? ''),
              );
              entry.imageAlt = String(next.attrs['imageAlt'] ?? '');
              draw(entry);
              return true;
            },
            destroy() {
              drawn.delete(entry);
            },
          };
        };
      },
    }),
  };
}

/** The blocks as the JSON the library takes (its own type is the same shape, writable). */
function jsonOf(blocks: RichText): JSONContent {
  return documentOf(blocks) as JSONContent;
}

/** The description of the picture that is selected; `null` when the selection is no picture. */
function selectedImageAlt(editor: Editor): string | null {
  const { selection } = editor.state;
  return selection instanceof NodeSelection &&
    selection.node.type.name === UiRichNodeName.Image
    ? String(selection.node.attrs['imageAlt'] ?? '')
    : null;
}

function stateOf(editor: Editor): UiRichEditorState {
  const link = editor.isActive(UiRichMarkName.Link)
    ? editor.getAttributes(UiRichMarkName.Link)['href']
    : null;
  return {
    paragraph: editor.isActive(UiRichNodeName.Paragraph),
    heading1: editor.isActive(UiRichNodeName.Heading, { level: 1 }),
    heading2: editor.isActive(UiRichNodeName.Heading, { level: 2 }),
    bold: editor.isActive(UiRichMarkName.Bold),
    italic: editor.isActive(UiRichMarkName.Italic),
    bulletList: editor.isActive(UiRichNodeName.BulletList),
    orderedList: editor.isActive(UiRichNodeName.OrderedList),
    quote: editor.isActive(UiRichNodeName.Blockquote),
    link: typeof link === 'string' ? link : null,
    hasSelection: !editor.state.selection.empty,
    canUndo: editor.can().undo(),
    canRedo: editor.can().redo(),
    imageAlt: selectedImageAlt(editor),
  };
}

export function createRichTextEngine(
  options: UiRichEngineOptions,
): UiRichEngine {
  let copied: Copied | null = null;
  const pictures = richImage(options.imageSource, new Set());

  const remember = (view: EditorView): boolean => {
    const { selection } = view.state;
    if (!selection.empty) {
      const slice = selection.content();
      copied = {
        slice,
        text: slice.content.textBetween(0, slice.content.size, '\n\n'),
      };
    }
    // The library still writes the clipboard.
    return false;
  };

  const editor = new Editor({
    element: options.element,
    injectCSS: false,
    editable: options.editable,
    content: jsonOf(options.blocks),
    extensions: [
      Document,
      Text,
      Paragraph.configure({
        HTMLAttributes: { class: 'ui-rich-text__paragraph' },
      }),
      // Drawn as `ui-rich-text` draws a heading: the level under the host's.
      Heading.extend({
        renderHTML({ node, HTMLAttributes }) {
          const level = node.attrs['level'] === 1 ? 1 : 2;
          return [
            'p',
            mergeAttributes(HTMLAttributes, {
              class: 'ui-rich-text__heading',
              role: 'heading',
              'aria-level': String(options.headingLevel + level - 1),
              'data-level': String(level),
            }),
            0,
          ];
        },
      }).configure({ levels: [1, 2] }),
      Bold,
      Italic,
      // A quote holds words only; a list item is one line.
      Blockquote.extend({ content: 'paragraph+' }).configure({
        HTMLAttributes: { class: 'ui-rich-text__quote' },
      }),
      BulletList.configure({ HTMLAttributes: { class: 'ui-rich-text__list' } }),
      OrderedList.configure({
        HTMLAttributes: { class: 'ui-rich-text__list' },
      }),
      ListItem.extend({ content: 'paragraph' }),
      ListKeymap,
      HardBreak,
      Link.configure({
        openOnClick: false,
        autolink: false,
        linkOnPaste: false,
        HTMLAttributes: { 'data-link': '', rel: null, target: null },
        isAllowedUri: (url) => RichTextSystem.linkHref(url) === url,
      }),
      pictures.node,
      UndoRedo,
      Dropcursor,
      Placeholder.configure({ placeholder: options.placeholder }),
    ],
    editorProps: {
      attributes: {
        class: 'ui-rich-text ui-rich-text-editor__content',
        role: 'textbox',
        'aria-multiline': 'true',
        'aria-label': options.label,
      },
      handleDOMEvents: {
        copy: remember,
        cut: remember,
        paste(view, event) {
          event.preventDefault();
          const files = imageFilesOf(event.clipboardData);
          if (files.length > 0) {
            options.onFiles(files);
            return true;
          }
          const text = event.clipboardData?.getData('text/plain') ?? '';
          if (text.length === 0) return true;
          if (copied !== null && copied.text === text) {
            view.dispatch(
              view.state.tr.replaceSelection(copied.slice).scrollIntoView(),
            );
          } else {
            view.pasteText(text, event);
          }
          return true;
        },
        drop(view, event) {
          // A piece dragged inside the editor is moved by the library; a
          // drop from outside would be read as HTML, so only its picture
          // files are taken — put where they were dropped.
          if (view.dragging) return false;
          event.preventDefault();
          const files = imageFilesOf(event.dataTransfer);
          if (files.length === 0) return true;
          const at = view.posAtCoords({
            left: event.clientX,
            top: event.clientY,
          });
          if (at !== null) editor.commands.setTextSelection(at.pos);
          options.onFiles(files);
          return true;
        },
      },
    },
    onUpdate: () => options.onChange(),
    onTransaction: ({ editor: current }) => options.onState(stateOf(current)),
    onFocus: () => options.onFocus(true),
    onBlur: () => options.onFocus(false),
  });
  options.onState(stateOf(editor));

  return {
    blocks: () => blocksOf(editor.getJSON() as UiRichNode),
    setBlocks(blocks: RichText) {
      // A new state, not a change to the old one: another text's history
      // must not be undone into this one.
      editor.view.updateState(
        EditorState.create({
          schema: editor.schema,
          doc: editor.schema.nodeFromJSON(jsonOf(blocks)),
          plugins: editor.state.plugins,
        }),
      );
      options.onState(stateOf(editor));
    },
    run(command) {
      const chain = editor.chain().focus();
      switch (command) {
        case UiRichCommand.Paragraph:
          chain.setParagraph().run();
          break;
        case UiRichCommand.Heading1:
          chain.toggleHeading({ level: 1 }).run();
          break;
        case UiRichCommand.Heading2:
          chain.toggleHeading({ level: 2 }).run();
          break;
        case UiRichCommand.Bold:
          chain.toggleBold().run();
          break;
        case UiRichCommand.Italic:
          chain.toggleItalic().run();
          break;
        case UiRichCommand.BulletList:
          chain.toggleBulletList().run();
          break;
        case UiRichCommand.OrderedList:
          chain.toggleOrderedList().run();
          break;
        case UiRichCommand.Quote:
          chain.toggleBlockquote().run();
          break;
        case UiRichCommand.Undo:
          chain.undo().run();
          break;
        case UiRichCommand.Redo:
          chain.redo().run();
          break;
      }
    },
    setLink(href) {
      const chain = editor.chain().focus();
      if (href === null) {
        chain.extendMarkRange(UiRichMarkName.Link).unsetLink().run();
      } else if (
        editor.state.selection.empty &&
        !editor.isActive(UiRichMarkName.Link)
      ) {
        // Nothing chosen: the address itself is the words.
        chain
          .insertContent({
            type: UiRichNodeName.Text,
            text: href.replace(/^(https?:\/\/|mailto:|tel:)/i, ''),
            marks: [{ type: UiRichMarkName.Link, attrs: { href } }],
          })
          .run();
      } else {
        chain.extendMarkRange(UiRichMarkName.Link).setLink({ href }).run();
      }
    },
    insertImage(imageId) {
      // After the selection, never over it: picking a picture must not
      // delete the words that happen to be selected.
      editor
        .chain()
        .focus()
        .insertContentAt(editor.state.selection.to, {
          type: UiRichNodeName.Image,
          attrs: { imageId, imageAlt: '' },
        })
        .run();
      // The picture just put in is selected, so its description row opens
      // on it: a picture is described while it is in view.
      let at = -1;
      editor.state.doc.descendants((node, pos) => {
        if (
          node.type.name === UiRichNodeName.Image &&
          node.attrs['imageId'] === imageId
        ) {
          at = pos;
        }
      });
      if (at >= 0) editor.commands.setNodeSelection(at);
    },
    setImageAlt(imageAlt) {
      if (selectedImageAlt(editor) === null) return;
      editor.commands.updateAttributes(UiRichNodeName.Image, { imageAlt });
    },
    removeImage() {
      if (selectedImageAlt(editor) === null) return;
      editor.view.dispatch(editor.state.tr.deleteSelection());
      editor.view.focus();
    },
    refreshImages: pictures.redraw,
    setEditable: (editable) => editor.setEditable(editable),
    focus: () => {
      editor.commands.focus();
    },
    destroy: () => editor.destroy(),
  };
}
