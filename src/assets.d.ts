/**
 * Imported image files, as bytes inside the bundle.
 *
 * `?inline` is what makes this work at all: a mod ships as **one file**, so an image that Vite
 * emitted alongside it would simply not be there when the loader fetched the bundle. The suffix
 * forces a `data:` URI into the JavaScript itself, whatever the file's size, rather than leaving
 * it to `build.assetsInlineLimit`.
 */
declare module "*.png?inline" {
  const dataUri: string;
  export default dataUri;
}
