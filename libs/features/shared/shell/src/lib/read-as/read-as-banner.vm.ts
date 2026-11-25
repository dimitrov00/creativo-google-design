/** The support read-as's banner as it prints (OR-24) — `null` on a plain session. */
export type ReadAsBannerVm = {
  /** «Действаш като Иван Колев» */
  readonly title: string;
  /** «до 14:32» on the shop's clock; `''` until the shop's zone is known. */
  readonly until: string;
  /** «Край» */
  readonly end: string;
  /** The bar's accessible name. */
  readonly label: string;
};
