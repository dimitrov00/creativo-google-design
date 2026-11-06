import {
  ClientCardPage,
  WalletAnchor,
} from '@creativo/features/staff/client-card';
import { EditorPage } from './visit-editor.vm';

/**
 * The card's own pages, as the client card's store titles them
 * (`ClientCardStore.barTitle`) — the editor's page kinds the card names.
 */
export const editorCardPages = {
  [EditorPage.Client]: ClientCardPage.Client,
  [EditorPage.Photo]: ClientCardPage.Photo,
  [EditorPage.ClientLoyalty]: ClientCardPage.ClientLoyalty,
  [EditorPage.ClientLedger]: ClientCardPage.ClientLedger,
  [EditorPage.ClientAchievements]: ClientCardPage.ClientAchievements,
  [EditorPage.ClientRecords]: ClientCardPage.ClientRecords,
  [EditorPage.AchievementCategory]: ClientCardPage.AchievementCategory,
  [EditorPage.AchievementDetail]: ClientCardPage.AchievementDetail,
  [EditorPage.ClientHistory]: ClientCardPage.ClientHistory,
} as const satisfies Partial<Record<EditorPage, ClientCardPage>>;

/**
 * Each wallet section's tile on the glance, as its test id names it
 * (`client-loyalty-<word>`, the push's origin): the catalogue's section is
 * the points tile's.
 */
export const WALLET_TILE_WORDS = {
  [WalletAnchor.Catalog]: 'points',
  [WalletAnchor.Stamps]: 'stamps',
  [WalletAnchor.Rhythm]: 'rhythm',
  [WalletAnchor.Wallet]: 'wallet',
  [WalletAnchor.Status]: 'status',
} as const satisfies Record<WalletAnchor, string>;

/**
 * Whether a landing may focus this element: a control, a link, or a box
 * that asked for it (`tabindex`) and is not disabled. A static article or
 * a plain span is as good as gone for the focus.
 */
export function canTakeFocus(element: HTMLElement): boolean {
  return (
    element.matches(
      'a[href], button, input, select, textarea, summary, [tabindex], [contenteditable]',
    ) && !element.matches(':disabled')
  );
}
