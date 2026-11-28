/*
 * THE RICH TEXT EDITOR, on its own entry
 * (`@creativo/ui/controls/rich-text-editor`): only the screens where staff
 * write a description mount it, so it stays out of the controls barrel
 * every route loads — through the barrel its toolbar, link row and styles
 * rode into each of them. The editor library itself is a further chunk,
 * fetched when an editor is first drawn.
 */
export * from './lib/rich-text-editor/rich-text-editor';
export type {
  UiRichImageSource as UiRichEditorImageSource,
  UiRichImageUpload,
} from './lib/rich-text-editor/rich-text-editor.model';
