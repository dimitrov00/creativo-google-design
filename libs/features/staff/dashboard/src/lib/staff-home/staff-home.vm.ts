/** The setup card on a barber's own schedule: what is left of their profile, and the way to it. */
export type SetupCardVm = {
  readonly title: string;
  /** «2 от 5 готови. Снимката и няколко думи за теб…» */
  readonly body: string;
  /** «Продължи» */
  readonly action: string;
};

/** One face of the welcome's orbit (the shape `ui-avatar-orbit` seats). */
export type WelcomeFaceVm = {
  readonly id: string;
  readonly name: string;
  /** `null` draws the monogram. */
  readonly avatarSrc: string | null;
};

/** The welcome page: who joins whom, greeted by name. */
export type WelcomeVm = {
  /** The newcomer, at the centre of the orbit. */
  readonly own: WelcomeFaceVm;
  /** Everyone they join, in the team's order; the orbit seats what fits. */
  readonly colleagues: readonly WelcomeFaceVm[];
  /** Everyone the orbit stands for, for assistive tech. */
  readonly facesLabel: string;
  /** «Петър, вече си в екипа» */
  readonly headline: string;
  /** «Ще работиш с Иван, Нико и още 3.» */
  readonly lede: string;
};
