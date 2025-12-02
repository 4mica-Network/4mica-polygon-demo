/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_PLAYLIST_URL: string
  readonly VITE_WALLET_PRIVATE_KEY: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
