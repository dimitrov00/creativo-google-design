/** `translate(key, params)` in the language the catalogue has loaded. */
export type Translate = (
  key: string,
  params?: Readonly<Record<string, unknown>>,
) => string;

/**
 * The words the code step prints from its phase (`auth.code.*`): the
 * headline and the lede that say where the code is. The step's fixed labels
 * («Промени», the resend row) are read by its template.
 */
export type CodeStepWords = {
  /** «Изпращаме кода…» */
  readonly sendingTitle: string;
  /** «до» — the lede before the destination while sending. */
  readonly sendingTo: string;
  /** «Провери пощата си» */
  readonly waitingTitleEmail: string;
  /** «Провери съобщенията си» */
  readonly waitingTitlePhone: string;
  /** «Изпратихме 6-цифрен код на» */
  readonly sentTo: string;
  /** «Проверяваме…» */
  readonly checkingTitle: string;
  /** «Готово» */
  readonly acceptedTitle: string;
  /** «Влизаме в профила ти…» */
  readonly acceptedLede: string;
  /** «Отвори Gmail» */
  readonly openWebmail: (brand: string) => string;
};

/** The code step's words in one language. */
export function codeStepWordsOf(translate: Translate): CodeStepWords {
  const at = (key: string, params?: Readonly<Record<string, unknown>>) =>
    translate(`auth.code.${key}`, params);
  return {
    sendingTitle: at('sendingTitle'),
    sendingTo: at('sendingTo'),
    waitingTitleEmail: at('title.email'),
    waitingTitlePhone: at('title.phone'),
    sentTo: at('sentTo'),
    checkingTitle: at('checking'),
    acceptedTitle: at('doneTitle'),
    acceptedLede: translate('auth.settling'),
    openWebmail: (provider) => at('openWebmail', { provider }),
  };
}
