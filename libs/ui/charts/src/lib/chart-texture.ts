/** The ids a chart's texture refers to — unique per chart on the page. */
export type ChartTextureIds = {
  readonly pattern: string;
  readonly fade: string;
  readonly mask: string;
};

let nextTextureId = 0;

/** Fresh ids for one chart's texture pattern, its fade and its mask. */
export function chartTextureIds(): ChartTextureIds {
  const n = nextTextureId++;
  return {
    pattern: `ui-chart-texture-${n}`,
    fade: `ui-chart-texture-fade-${n}`,
    mask: `ui-chart-texture-mask-${n}`,
  };
}
