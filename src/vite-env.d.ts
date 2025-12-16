/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_PLAYLIST_URL: string
  readonly VITE_STREAM_SERVER_URL: string
  readonly VITE_4MICA_RPC_URL: string
  readonly VITE_DEFAULT_TOKEN_ADDRESS: string
  readonly VITE_ETH_RPC_PROXY_URL: string
  readonly VITE_ENABLE_EXTERNAL_STREAMING: string
  readonly VITE_SIGNER_SERVICE_URL: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

declare module '@videojs/http-streaming/src/config' {
  interface VhsConfig {
    GOAL_BUFFER_LENGTH: number
    MAX_GOAL_BUFFER_LENGTH: number
    BACK_BUFFER_LENGTH: number
    GOAL_BUFFER_LENGTH_RATE: number
    INITIAL_BANDWIDTH: number
    BANDWIDTH_VARIANCE: number
    BUFFER_LOW_WATER_LINE: number
    MAX_BUFFER_LOW_WATER_LINE: number
    EXPERIMENTAL_MAX_BUFFER_LOW_WATER_LINE: number
    BUFFER_LOW_WATER_LINE_RATE: number
    BUFFER_HIGH_WATER_LINE: number
  }
  const config: VhsConfig
  export default config
}
