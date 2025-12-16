# 4mica x Polygon Demo

Pay-per-segment video streaming on Polygon-Amoy, powered by 4mica.

This demo showcases how content providers can monetize HLS video streams using the x402 payment standard. Viewers pay for each video segment they watch, with payments processed through 4mica's facilitator and settled on Polygon-Amoy.

## Setup

Copy `.env.default` to `.env` and update the values:

```bash
cp .env.default .env
```

### Environment Variables

**Server:**

- `FILE_DIRECTORY` - Directory path containing HLS video files (default: ./data/hls)
- `X402_ENABLED` - Enable x402 payment flow
- `X402_PAY_TO` - Wallet address to receive payments
- `X402_RPC_URL` - JSON-RPC endpoint used to verify on-chain x402 payments
- `4MICA_WALLET_PRIVATE_KEY` - Private key used by the Rust server for 4mica tab logging (not exposed to the client)

**Signer (Node service, keeps the key off the client):**

- `SIGNER_PRIVATE_KEY` - Wallet private key used for signing payments
- `SIGNER_RPC_URL` - RPC URL used by the signer (default: Polygon Amoy public RPC)
- `SIGNER_PORT` / `SIGNER_HOST` - Where the signer service listens (default: 0.0.0.0:4000)
- `SIGNER_CHAIN_ID` - Expected chain ID (default: 80002)

**Client:**

- `VITE_PLAYLIST_URL` - HLS playlist URL for the video stream
- `VITE_STREAM_SERVER_URL` - Stream server URL (default: http://localhost:3000)
- `VITE_4MICA_RPC_URL`, `VITE_DEFAULT_TOKEN_ADDRESS`, `VITE_ETH_RPC_PROXY_URL` - RPC + token defaults
- `VITE_ENABLE_EXTERNAL_STREAMING` - Enable streaming from external URLs (required for videos outside server's `FILE_DIRECTORY`, default: false)
- `VITE_SIGNER_SERVICE_URL` - URL the client will call for signatures (default: http://localhost:4000)

## Running the Demo

**Start the signer service (required):**

```bash
SIGNER_PRIVATE_KEY=0xyourkey npm run signer
```

**Start the server:**

```bash
cargo run -p server
```

**Start the client:**

```bash
yarn install
yarn dev
```

## Customization

To stream a different video, update `VITE_PLAYLIST_URL` in your `.env` file with any HLS playlist address.

**Note:** If you want to stream a video that is not located in the server's `FILE_DIRECTORY` path (configured in the server), you must set `VITE_ENABLE_EXTERNAL_STREAMING=true` in your `.env` file to enable streaming from external sources.

## Docker Deployment

To run the client and server behind nginx with Docker Compose, see `DEPLOYMENT.md`.
