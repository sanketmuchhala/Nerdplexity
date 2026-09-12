/** Vite resolves `?url` imports to the emitted asset's URL. */
declare module '*.svg?url' {
  const url: string;
  export default url;
}
