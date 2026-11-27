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
import { EditorState } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import type { RichText } from '@core/components';
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

/** A picture a body names — kept through an edit, shown as a labelled plate. */
const RichImage = Node.create({
  name: UiRichNodeName.Image,
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,
  addAttributes() {
    return { imageId: { default: '' }, imageAlt: { default: '' } };
  },
  renderHTML({ node }) {
    const alt = String(node.attrs['imageAlt'] ?? '');
    return [
      'div',
      { class: 'ui-rich-text-editor__image' },
      alt.length > 0 ? alt : String(node.attrs['imageId'] ?? ''),
    ];
  },
});

/** The blocks as the JSON the library takes (its own type is the same shape, writable). */
function jsonOf(blocks: RichText): JSONContent {
  return documentOf(blocks) as JSONContent;
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
  };
}

export function createRichTextEngine(
  options: UiRichEngineOptions,
): UiRichEngine {
  let copied: Copied | null = null;

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
      RichImage,
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
          // drop from outside would be read as HTML, so it is not taken.
          if (view.dragging) return false;
          event.preventDefault();
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
    setEditable: (editable) => editor.setEditable(editable),
    focus: () => {
      editor.commands.focus();
    },
    destroy: () => editor.destroy(),
  };
}
