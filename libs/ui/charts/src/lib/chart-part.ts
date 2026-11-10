/**
 * THE KIT'S PART VOCABULARY — the `data-part` hook every mark carries, and
 * the only thing that decides a mark's colour (charts.css maps each value to
 * a token; `fill`/`stroke`, never `color`). Plain strings, because `type:ui`
 * cannot import ecs-core: a feature's presenter maps its own tags to these
 * (the analytics feature's `BAR_PART_HOOKS` table already prints them).
 *
 * | part         | paints                                              |
 * | ------------ | --------------------------------------------------- |
 * | `worked`     | the accent — the work, "this period"                |
 * | `no-show`    | `--sys-color-destructive`                           |
 * | `unmarked`   | `--sys-color-warning` under a diagonal hatch        |
 * | `blocked`    | the foreground at 76 %                              |
 * | `unsold`     | the foreground at 62 %                              |
 * | `other`      | the foreground at 48 %                              |
 * | `online`     | the accent — bookings the client made               |
 * | `staff`      | the foreground at 62 %                              |
 * | `unknown`    | the foreground at 48 %                              |
 * | `comparison` | the 48 % grey — the previous period's line or bars  |
 *
 * The greys are 76 / 62 / 48 % and not the design's 50 / 32 / 18 because a
 * mark has to clear 3:1 on white (charts.css says the arithmetic).
 */
export const UiChartPart = {
  Worked: 'worked',
  NoShow: 'no-show',
  Unmarked: 'unmarked',
  Blocked: 'blocked',
  Unsold: 'unsold',
  Other: 'other',
  Online: 'online',
  Staff: 'staff',
  Unknown: 'unknown',
  Comparison: 'comparison',
} as const;

export type UiChartPart = (typeof UiChartPart)[keyof typeof UiChartPart];

/** Every part, in dictionary order: the stylesheet and its spec cover all of them. */
export const UI_CHART_PARTS: readonly UiChartPart[] =
  Object.values(UiChartPart);

/**
 * A value the grid rules, and its words (the kit formats no number) — the
 * line chart's and the vertical bar chart's value grid alike.
 */
export type UiChartTick = {
  readonly value: number;
  readonly text: string;
};
