# Environment Variables Setup

Create a `.env` file in the root directory with the following variables:

```env
VITE_PLAYLIST_URL=http://localhost:8080/playlist.m3u8
VITE_WALLET_PRIVATE_KEY=your_wallet_private_key_here
```

## Variables

- **VITE_PLAYLIST_URL**: The URL to your HLS playlist (.m3u8 file)
- **VITE_WALLET_PRIVATE_KEY**: Your wallet's private key for handling X402 payments

## Default Values

If these variables are not set, the application will use:
- Playlist URL: `http://localhost:8080/playlist.m3u8`
- Wallet Private Key: Empty string

## Security Note

Never commit your `.env` file to version control. It should already be in `.gitignore`.

