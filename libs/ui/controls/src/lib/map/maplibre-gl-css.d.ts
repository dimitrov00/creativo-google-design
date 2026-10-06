/**
 * MapLibre's own stylesheet as the application builder's `loader: 'text'`
 * import attribute delivers it: the file's CSS, as one string.
 *
 * True ONLY under that attribute — `maplibre-loader.ts` is the one importer,
 * and it pulls this declaration into every program that compiles it.
 */
declare module 'maplibre-gl/dist/maplibre-gl.css' {
  const css: string;
  export default css;
}
