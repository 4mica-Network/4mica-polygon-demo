interface Config {
  playlistUrl: string
  streamServerUrl: string
  rpcUrl: string
  defaultTokenAddress: string
  rpcProxyUrl: string
  enableExternalStreaming: boolean
  signerServiceUrl: string
}

export const config: Config = {
  playlistUrl: import.meta.env.VITE_PLAYLIST_URL || 'http://localhost:8080/playlist.m3u8',
  streamServerUrl: import.meta.env.VITE_STREAM_SERVER_URL || 'http://localhost:3000',
  rpcUrl: import.meta.env.VITE_4MICA_RPC_URL || 'https://api.4mica.xyz/',
  defaultTokenAddress: import.meta.env.VITE_DEFAULT_TOKEN_ADDRESS || '0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582',
  rpcProxyUrl: import.meta.env.VITE_ETH_RPC_PROXY_URL || 'https://polygon-amoy-bor-rpc.publicnode.com',
  enableExternalStreaming: (import.meta.env.VITE_ENABLE_EXTERNAL_STREAMING || 'false').toLowerCase() !== 'false',
  signerServiceUrl: import.meta.env.VITE_SIGNER_SERVICE_URL || 'http://localhost:4000',
}
