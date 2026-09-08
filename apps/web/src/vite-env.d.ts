/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL of the tables API. Defaults to `/api` (dev proxy). Baked at build time. */
  readonly VITE_API_BASE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
