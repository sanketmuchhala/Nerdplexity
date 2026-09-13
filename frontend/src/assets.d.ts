/** Vite resolves `?url` imports to the emitted asset's URL. */
declare module '*.svg?url' {
  const url: string;
  export default url;
}

interface ImportMetaEnv {
  /** Backend address for a hosted frontend, for example https://nerdplexity-api.onrender.com. */
  readonly VITE_API_URL?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
