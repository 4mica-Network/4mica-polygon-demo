import { useCallback, useMemo, useState } from 'react'
import type Player from 'video.js/dist/types/player'
import VideoPlayer from './components/VideoPlayer'
import { config } from './config/env'
import { TARGET_CHAIN_ID, useWallet } from './context/WalletContext'
import { createPaymentHandler } from './utils/paymentHandler'

function App() {
  const [playerReady, setPlayerReady] = useState<boolean>(false)
  const { address, chainId, isConnecting, error, isConnected, connect, disconnect, signer, switchToTargetChain } = useWallet()

  const getSigner = useCallback(async () => signer, [signer])
  const paymentHandler = useMemo(() => createPaymentHandler(getSigner), [getSigner])

  const handleConnect = async () => {
    try {
      await connect()
    } catch (err) {
      console.error('Wallet connection failed', err)
    }
  }

  const handlePlayerReady = (player: Player): void => {
    setPlayerReady(true)

    player.on('error', () => {
      const error = player.error()
      console.error('Video.js error:', error)
    })
  }

  const renderConnectScreen = () => (
    <div className='grid md:grid-cols-2 gap-6 items-stretch relative z-10'>
      <div className='bg-gradient-to-br from-indigo-500/20 via-purple-500/10 to-emerald-400/10 border border-white/10 rounded-2xl p-8 shadow-2xl h-full'>
        <div className='inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/10 text-xs uppercase tracking-wide text-indigo-100 mb-4'>
          <span className='text-lg'>⚡</span>
          <span>Polygon-Amoy</span>
        </div>
        <h2 className='text-2xl md:text-3xl text-white font-semibold mb-3'>Connect wallet to start streaming</h2>
        <p className='text-gray-200 mb-6 leading-relaxed'>
          We’ll sign x402 payments from your wallet as you watch. You can choose to pay with using x402 or to pay with 4Mica credit integrated with x402 for a smoothflow! 
        </p>
        <div className='space-y-3 text-gray-200'>
          <div className='flex items-start gap-3'>
            <div className='w-2.5 h-2.5 rounded-full bg-emerald-400 mt-1.5' />
            <div>
              <div className='font-semibold'>Instant connect</div>
              <div className='text-gray-400 text-sm'>MetaMask, WalletConnect, or any injected EVM wallet.</div>
            </div>
          </div>
          <div className='flex items-start gap-3'>
            <div className='w-2.5 h-2.5 rounded-full bg-indigo-400 mt-1.5' />
            <div>
              <div className='font-semibold'>Secure signing</div>
              <div className='text-gray-400 text-sm'>Typed-data signatures only; no private keys stored.</div>
            </div>
          </div>
          <div className='flex items-start gap-3'>
            <div className='w-2.5 h-2.5 rounded-full bg-purple-400 mt-1.5' />
            <div>
              <div className='font-semibold'>Instant Settlement with 4Mica</div>
              <div className='text-gray-400 text-sm'>4Mica credit payment handles pay for each segment instantly and at zero-cost</div>
            </div>
          </div>
        </div>
      </div>

      <div className='bg-slate-900/70 border border-white/10 rounded-2xl p-8 shadow-2xl backdrop-blur-md h-full flex flex-col justify-between'>
        <div className='space-y-4'>
          <div className='flex items-center justify-between'>
            <div className='text-gray-100 font-semibold text-lg'>Wallet connection</div>
            <div className='px-3 py-1 rounded-full text-xs bg-indigo-500/20 text-indigo-100 border border-indigo-500/40'>
              Required to continue
            </div>
          </div>
          <div className='rounded-xl border border-white/5 bg-white/5 px-4 py-3 flex items-center justify-between'>
            <div>
              <div className='text-gray-200 font-medium'>Network</div>
              <div className='text-gray-400 text-sm'>Polygon-Amoy (80002)</div>
            </div>
            <div className='px-3 py-1 rounded-full bg-emerald-500/15 text-emerald-200 text-xs'>Ready</div>
          </div>
          <div className='rounded-xl border border-white/5 bg-white/5 px-4 py-3 flex items-center justify-between'>
            <div>
              <div className='text-gray-200 font-medium'>Wallet status</div>
              <div className='text-gray-400 text-sm'>{isConnecting ? 'Awaiting approval…' : 'Not connected'}</div>
            </div>
            <div className='px-3 py-1 rounded-full bg-yellow-500/15 text-yellow-200 text-xs'>Action needed</div>
          </div>
        </div>

        <div className='space-y-3 mt-6'>
          <button
            onClick={handleConnect}
            className='w-full px-5 py-3 rounded-xl bg-indigo-500 text-white hover:bg-indigo-400 transition disabled:opacity-60 shadow-lg shadow-indigo-500/30'
            disabled={isConnecting}
          >
            {isConnecting ? 'Connecting...' : 'Connect wallet'}
          </button>
          {error && <div className='text-sm text-red-400 text-center'>{error}</div>}
          <div className='text-xs text-gray-400 text-center'>
            Please approve the connection in your wallet. We never request spend permissions here.
          </div>
        </div>
      </div>
    </div>
  )

  const renderPlayerScreen = () => {
    const onWrongChain = chainId !== null && chainId !== TARGET_CHAIN_ID
    return (
      <>
        <div className='bg-gray-800 border border-gray-700 rounded-lg p-4 flex items-center justify-between gap-4'>
          <div className='flex flex-col sm:flex-row sm:items-center sm:gap-4'>
            <div className='text-gray-200 font-medium'>{`Connected: ${address}`}</div>
            <div className='text-gray-400 text-sm'>
              {chainId ? `Chain ID: ${chainId}` : 'Polygon-Amoy (80002) required'}
            </div>
          </div>
          <div className='flex gap-2'>
            <button
              onClick={disconnect}
              className='px-4 py-2 rounded bg-red-600 text-white hover:bg-red-500 transition'
            >
              Disconnect
            </button>
          </div>
        </div>

        {onWrongChain ? (
          <div className='mt-6 bg-yellow-500/10 border border-yellow-500/40 rounded-xl p-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4'>
            <div>
              <div className='text-yellow-100 font-semibold text-lg'>Switch to Polygon Amoy</div>
              <div className='text-yellow-200 text-sm mt-1'>
                You are on chain {chainId}. Switch to 80002 (Polygon Amoy) to continue streaming and signing payments.
              </div>
            </div>
            <button
              onClick={switchToTargetChain}
              className='px-4 py-2 rounded-lg bg-yellow-400 text-gray-900 font-semibold hover:bg-yellow-300 transition'
              disabled={isConnecting}
            >
              Switch network
            </button>
          </div>
        ) : (
          <div className='bg-black rounded-lg overflow-hidden shadow-2xl mt-6'>
            <VideoPlayer src={config.playlistUrl} onReady={handlePlayerReady} paymentHandler={paymentHandler} />
          </div>
        )}

        {playerReady && !onWrongChain && <div className='mt-4 text-center text-gray-400 text-sm'>Player ready</div>}
      </>
    )
  }

  return (
    <div className='relative min-h-screen bg-gradient-to-br from-slate-950 via-indigo-950 to-slate-900 flex items-center justify-center p-4 overflow-hidden'>
      <div className='absolute -top-40 -right-24 h-80 w-80 bg-indigo-500/30 blur-3xl rounded-full pointer-events-none' />
      <div className='absolute -bottom-32 -left-10 h-80 w-80 bg-emerald-500/20 blur-3xl rounded-full pointer-events-none' />
      <div className='w-full max-w-6xl'>
        <div className='mb-4'>
          <h1 className='text-2xl font-light text-gray-100 tracking-wide'>4Mica x Polygon Demo</h1>
          <p className='text-gray-400 text-sm mt-1'>Connect a wallet to sign x402 payments on Polygon-Amoy.</p>
        </div>

        {isConnected ? renderPlayerScreen() : renderConnectScreen()}
      </div>
    </div>
  )
}

export default App
