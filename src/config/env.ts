interface Config {
  playlistUrl: string
  walletPrivateKey: string
  streamServerUrl: string
  rpcUrl: string
  defaultTokenAddress: string
}

export const config: Config = {
  playlistUrl: import.meta.env.VITE_PLAYLIST_URL || 'http://localhost:8080/playlist.m3u8',
  walletPrivateKey: import.meta.env.VITE_WALLET_PRIVATE_KEY || '',
  streamServerUrl: import.meta.env.VITE_STREAM_SERVER_URL || 'http://localhost:3000',
  rpcUrl: import.meta.env.VITE_4MICA_RPC_URL || 'https://api.4mica.xyz/',
  defaultTokenAddress: import.meta.env.VITE_DEFAULT_TOKEN_ADDRESS || '0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582',
}
