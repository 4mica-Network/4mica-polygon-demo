# Environment Variables Setup

Create a `.env` file in the root directory (start from `.env.default`). The signing key now lives in a backend service so it never ships to the browser.

```env
# Signer (server-side only)
SIGNER_PRIVATE_KEY=your_wallet_private_key_here
SIGNER_RPC_URL=https://polygon-amoy-bor-rpc.publicnode.com
SIGNER_CORE_RPC_URL=https://api.4mica.xyz/
# or set 4MICA_RPC_URL instead of SIGNER_CORE_RPC_URL
SIGNER_PORT=4000
SIGNER_HOST=0.0.0.0
SIGNER_CHAIN_ID=80002

# Server logging (optional, for 4mica tab logs)
4MICA_WALLET_PRIVATE_KEY=your_wallet_private_key_here

# Client (baked into the Vite build)
VITE_PLAYLIST_URL=http://localhost:8080/stream/big-buck-bunny.m3u8
VITE_STREAM_SERVER_URL=http://localhost:8080
VITE_4MICA_RPC_URL=https://api.4mica.xyz/
VITE_DEFAULT_TOKEN_ADDRESS=0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582
VITE_ETH_RPC_PROXY_URL=https://polygon-amoy-bor-rpc.publicnode.com
VITE_ENABLE_EXTERNAL_STREAMING=false
VITE_SIGNER_SERVICE_URL=http://localhost:4000
```

## Notes

- The private key is consumed only by the Node signer service (`npm run signer`) and is never bundled in the frontend.
- `SIGNER_RPC_URL` should point to the blockchain RPC; `SIGNER_CORE_RPC_URL`/`4MICA_RPC_URL` points to the 4mica Core API used by the SDK for collateral/guarantee calls.
- `4MICA_WALLET_PRIVATE_KEY` is used only by the Rust server to log tab snapshots; omit it if you don’t need those logs.
- Update `VITE_SIGNER_SERVICE_URL` to the public URL where the signer service is exposed (default `http://localhost:4000`).
- Never commit your `.env` file to version control. It should already be in `.gitignore`.
