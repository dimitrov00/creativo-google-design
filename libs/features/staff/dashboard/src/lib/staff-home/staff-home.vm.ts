/** The setup card on a barber's own schedule: what is left of their profile, and the way to it. */
export type SetupCardVm = {
  readonly title: string;
  /** «2 от 5 готови. Снимката и няколко думи за теб…» */
  readonly body: string;
  /** «Продължи» */
  readonly action: string;
};

/** One face of the welcome's hero. */
export type WelcomeFaceVm = {
  readonly id: string;
  readonly name: string;
  /** `null` draws the monogram. */
  readonly avatarSrc: string | null;
};

/** The welcome page: who joins whom, greeted by name. */
export type WelcomeVm = {
  /** The newcomer first, in front; then the colleagues shown. */
  readonly faces: readonly WelcomeFaceVm[];
  /** Colleagues past the faces shown; `0` draws no count. */
  readonly overflow: number;
  /** Everyone the faces stand for, for assistive tech. */
  readonly facesLabel: string;
  /** «Петър, вече си в екипа» */
  readonly headline: string;
  /** «Ще работиш с Иван, Нико и още 3.» */
  readonly lede: string;
};
