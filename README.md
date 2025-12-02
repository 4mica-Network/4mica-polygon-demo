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

- `X402_ENABLED` - Enable x402 payment flow
- `X402_PAY_TO` - Wallet address to receive payments

**Client:**

- `VITE_PLAYLIST_URL` - HLS playlist URL for the video stream
- `VITE_WALLET_PRIVATE_KEY` - Wallet private key for payments
- `VITE_STREAM_SERVER_URL` - Stream server URL (default: http://localhost:3000)

## Running the Demo

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
