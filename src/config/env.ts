interface Config {
  playlistUrl: string
  walletPrivateKey: string
  rpcUrl: string
}

export const config: Config = {
  playlistUrl: import.meta.env.VITE_PLAYLIST_URL || 'http://localhost:8080/playlist.m3u8',
  walletPrivateKey: import.meta.env.VITE_WALLET_PRIVATE_KEY || '',
  rpcUrl: import.meta.env.VITE_4MICA_RPC_URL || 'https://api.4mica.xyz/',
}
