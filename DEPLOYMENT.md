# Docker + nginx deployment

These steps build the Rust stream server and the Vite client into containers, serve the client with nginx, and reverse-proxy API/streaming traffic to the server.

## Prerequisites

- Docker + Docker Compose
- An `.env` file in the repo root (start from `.env.default`) that contains the server variables:
  - `X402_ENABLED`, `X402_PAY_TO`, `X402_RPC_URL`, etc.
  - Add `SERVER_ADVERTISED_URL` and set it to the public URL nginx will serve (e.g. `https://demo.example.com` or `http://localhost:8080`).
  - Add signer variables: `SIGNER_PRIVATE_KEY`, `SIGNER_RPC_URL` (chain RPC), optional `SIGNER_CORE_RPC_URL`/`4MICA_RPC_URL` (4mica Core API), and `SIGNER_CHAIN_ID`.
  - Add `4MICA_WALLET_PRIVATE_KEY` for server-side 4mica logging (not exposed to the client).

## Build and run

```bash
# 1) Prepare env
cp .env.default .env
# edit .env with your keys and SERVER_ADVERTISED_URL

# 2) Build images
docker compose build

# 3) Start stack (nginx on 8080, server on internal 3000)
docker compose up -d

# 4) Open the client
open http://localhost:8080
```

Stop the stack with `docker compose down`.

## What the containers do

- `server` (Rust, built with nightly + OpenSSL build deps to support edition 2024) reads HLS segments from `/app/data/hls` and listens on `:3000`.
- `web` (nginx) serves the built React app and proxies `/stream`, `/tab`, and `/rpc` to the `server` container. The nginx config is baked into `docker/Dockerfile.web`. Port `80` in the container maps to `8080` on the host by default.
- `web` build installs the published `sdk-4mica@0.2.1` package from npm during `npm ci`.
- `signer` (Node) runs `npm run signer` with your `SIGNER_PRIVATE_KEY` and listens on `:4000` (exposed to the host). The client calls this service for signatures so the key stays off the frontend.

## Configuration notes

- HLS content: the compose file mounts `./data` to `/app/data` (read-only). Make sure your `.m3u8` and `.ts` files live in `./data/hls`, or change the volume + `FILE_DIRECTORY` env to point elsewhere.
- Public URLs: set `SERVER_ADVERTISED_URL` so the server generates correct absolute URLs for payment flows. Also set `VITE_STREAM_SERVER_URL`, `VITE_PLAYLIST_URL`, and `VITE_SIGNER_SERVICE_URL` (passed as build args) to the public base you expose via nginx/ports.
- Rebuild when env changes: Vite embeds `VITE_*` values at build time. After changing any `VITE_` variable, rerun `docker compose build web`.
- TLS: the baked-in nginx config is HTTP-only. Terminate TLS in front of this stack (e.g. another nginx, Caddy, or a load balancer), or extend the nginx block inside `docker/Dockerfile.web` with your certs.
