import type { WebmailInbox } from '@core/systems';
import { IdentifierChannel } from '@core/primitives';
import {
  CODE_STEP_DISC_PHASE,
  CodeStepPhase,
  type CodeStepVm,
  WEBMAIL_BRAND,
} from './code-step.vm';
import type { CodeStepWords } from './code-step.words';

/** What the code step is worded from. */
export type CodeStepInput = {
  readonly codeStepPhase: CodeStepPhase;
  readonly identifierChannel: IdentifierChannel;
  /** The address or number the code went to; `null` once the flow forgot it (signed in). */
  readonly destination: string | null;
  /** The webmail `WebmailSystem.inboxOf` read from the address; `null` for none. */
  readonly webmail: WebmailInbox | null;
  readonly words: CodeStepWords;
};

/*
 * THE CODE STEP, WORDED (Law 10): one headline per phase over the mail
 * disc, the lede that says where the code is, and the «Отвори Gmail»
 * shortcut. Which phase the step is in is the store's (sending, checking)
 * and the flow machine's (accepted); which webmail an address names is
 * `WebmailSystem`'s. This only words them.
 */
export function codeStepVm(input: CodeStepInput): CodeStepVm {
  const { codeStepPhase, words } = input;
  const accepted = codeStepPhase === CodeStepPhase.Accepted;
  const waiting = codeStepPhase === CodeStepPhase.Waiting;
  return {
    codeStepPhase,
    // eslint-disable-next-line security/detect-object-injection -- `codeStepPhase` is a value of the closed CodeStepPhase dictionary the table is keyed by.
    discPhase: CODE_STEP_DISC_PHASE[codeStepPhase],
    title: titleOf(input),
    lede: accepted
      ? words.acceptedLede
      : codeStepPhase === CodeStepPhase.Sending
        ? words.sendingTo
        : words.sentTo,
    destination: accepted ? null : input.destination,
    canEdit: waiting || codeStepPhase === CodeStepPhase.Checking,
    locked: !waiting,
    accepted,
    showsResend: waiting || codeStepPhase === CodeStepPhase.Checking,
    webmail:
      waiting && input.webmail !== null
        ? {
            label: words.openWebmail(
              WEBMAIL_BRAND[input.webmail.webmailProvider],
            ),
            href: input.webmail.inboxUrl,
          }
        : null,
  };
}

function titleOf(input: CodeStepInput): string {
  const { words } = input;
  switch (input.codeStepPhase) {
    case CodeStepPhase.Sending:
      return words.sendingTitle;
    case CodeStepPhase.Checking:
      return words.checkingTitle;
    case CodeStepPhase.Accepted:
      return words.acceptedTitle;
    case CodeStepPhase.Waiting:
      return input.identifierChannel === IdentifierChannel.Phone
        ? words.waitingTitlePhone
        : words.waitingTitleEmail;
  }
}
