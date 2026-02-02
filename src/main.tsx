import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Buffer } from 'buffer'
import './index.css'
import App from './App'
import { WalletProvider } from './context/WalletContext'

// Ensure Buffer exists in the browser for @4mica/sdk
if (!(globalThis as any).Buffer) {
  ;(globalThis as any).Buffer = Buffer
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <WalletProvider>
      <App />
    </WalletProvider>
  </StrictMode>
)
