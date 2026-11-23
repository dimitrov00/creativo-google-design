import { WebmailProvider } from '@core/components';
import type { UiProgressDiscPhase } from '@creativo/ui/patterns';

/**
 * Where the code step stands — the field `codeStepPhase`. `SENDING`: a code
 * is on its way (the first send or a resend); `WAITING`: it is in the
 * inbox, the person's turn; `CHECKING`: a typed code is with the server
 * (the auto-verify beat included); `ACCEPTED`: it was right, the hand-off
 * is under way.
 */
export const CodeStepPhase = {
  Sending: 'SENDING',
  Waiting: 'WAITING',
  Checking: 'CHECKING',
  Accepted: 'ACCEPTED',
} as const;
export type CodeStepPhase = (typeof CodeStepPhase)[keyof typeof CodeStepPhase];

/** The mail disc's phase in each step phase: the ring turns while a request is out, the badge says the code landed, the filled disc says it was right. */
export const CODE_STEP_DISC_PHASE = {
  [CodeStepPhase.Sending]: 'busy',
  [CodeStepPhase.Waiting]: 'acknowledged',
  [CodeStepPhase.Checking]: 'busy',
  [CodeStepPhase.Accepted]: 'complete',
} as const satisfies Record<CodeStepPhase, UiProgressDiscPhase>;

/** How each webmail service prints — brand names, the same in every language. */
export const WEBMAIL_BRAND = {
  [WebmailProvider.Gmail]: 'Gmail',
  [WebmailProvider.Outlook]: 'Outlook',
  [WebmailProvider.Yahoo]: 'Yahoo',
  [WebmailProvider.ICloud]: 'iCloud',
  [WebmailProvider.Proton]: 'Proton',
  [WebmailProvider.Abv]: 'ABV',
  [WebmailProvider.MailBg]: 'Mail.bg',
} as const satisfies Record<WebmailProvider, string>;

/** «Отвори Gmail» — the shortcut to the person's own inbox, opened in a new tab. */
export type CodeStepWebmailVm = {
  readonly label: string;
  readonly href: string;
};

/** What the code step prints above and around the six slots. */
export type CodeStepVm = {
  readonly codeStepPhase: CodeStepPhase;
  readonly discPhase: UiProgressDiscPhase;
  readonly title: string;
  /** The lede's words before the destination, or the whole lede when `destination` is `null`. */
  readonly lede: string;
  /** The address or number the code went to, printed semibold after `lede`; `null` once the code was accepted. */
  readonly destination: string | null;
  /** Whether «Промени» rides the lede — only while the person is the one waited on. */
  readonly canEdit: boolean;
  /** The slots are locked: a request is out, or the code was accepted. */
  readonly locked: boolean;
  readonly accepted: boolean;
  /** The resend row (the countdown, then «Изпрати нов код») — hidden while a code is on its way and once one was accepted. */
  readonly showsResend: boolean;
  /** Offered only while the person is looking for the code, and only for a webmail the address names. */
  readonly webmail: CodeStepWebmailVm | null;
};
