import { useCallback, useMemo, useState } from 'react'
import type Player from 'video.js/dist/types/player'
import VideoPlayer from './components/VideoPlayer'
import BootstrapLoader from './components/BootstrapLoader'
import WalletSidebar from './components/WalletSidebar'
import ActivityLog from './components/ActivityLog'
import NetworkSwitchBanner from './components/NetworkSwitchBanner'
import { config } from './config/env'
import { TARGET_CHAIN_ID, useWallet } from './context/WalletContext'
import { createPaymentHandler, type PaymentScheme, type SchemeResolvedInfo, type PaymentTabInfo } from './utils/paymentHandler'
import { useActivityLog, useWalletBalance, useCollateral } from './hooks'

function App() {
  const {
    address,
    chainId,
    isConnecting,
    hasTriedEager,
    error,
    isConnected,
    connect,
    signer,
    switchToTargetChain,
  } = useWallet()

  const [paymentScheme, setPaymentScheme] = useState<PaymentScheme>('4mica-credit')

  const { logs, appendLog } = useActivityLog()

  const trackedTokens = useMemo(() => {
    const tokens = new Set<string>()
    if (config.defaultTokenAddress) tokens.add(config.defaultTokenAddress.toLowerCase())
    return Array.from(tokens)
  }, [])

  const { balance, balanceLoading, tokenBalances } = useWalletBalance(
    signer,
    address,
    isConnected,
    chainId,
    trackedTokens,
    appendLog
  )

  const { collateral, collateralLoading } = useCollateral(isConnected, address, appendLog)

  const handleConnect = async () => {
    try {
      await connect()
    } catch (err) {
      console.error('Wallet connection failed', err)
    }
  }

  const handlePlayerReady = (player: Player): void => {
    player.on('error', () => {
      const error = player.error()
      console.error('Video.js error:', error)
    })
  }

  const copyAddress = useCallback(async () => {
    if (!address) {
      appendLog('No wallet connected to copy.', 'warn')
      return
    }
    try {
      await navigator.clipboard?.writeText(address)
      appendLog('Wallet address copied.', 'success')
    } catch (err) {
      appendLog(`Copy failed: ${err instanceof Error ? err.message : String(err)}`, 'error')
    }
  }, [address, appendLog])

  const getPreferredScheme = useCallback(() => paymentScheme, [paymentScheme])

  const handleSchemeResolved = useCallback(
    ({ preferred, chosen, offered, usedFallback }: SchemeResolvedInfo) => {
      if (usedFallback && chosen.toLowerCase() !== preferred.toLowerCase()) {
        const offeredList = offered.filter(Boolean).join(', ')
        appendLog(
          `Payment rail ${preferred} unavailable; using ${chosen || 'fallback'}${
            offeredList ? ` (offered: ${offeredList})` : ''
          }.`,
          'warn'
        )
      }
    },
    [appendLog]
  )

  const handleTabObserved = useCallback(
    (_tab: PaymentTabInfo) => {},
    []
  )

  const getSigner = useCallback(async () => signer, [signer])

  const paymentHandler = useMemo(
    () => createPaymentHandler(getSigner, getPreferredScheme, handleSchemeResolved, handleTabObserved),
    [getSigner, getPreferredScheme, handleSchemeResolved, handleTabObserved]
  )

  const paymentEvents = useMemo(
    () => ({
      onPaymentRequested: (chunkId: string, amount?: string) => {
        appendLog(`#${chunkId} ${amount ? `${amount}` : ''}`, 'warn')
      },
      onPaymentSettled: (chunkId: string, amount?: string, txHash?: string) => {
        appendLog(`#${chunkId} ${amount ? `${amount}` : 'Settled'}`, 'success', txHash)
      },
      onPaymentFailed: (chunkId: string, err: unknown, amount?: string) => {
        appendLog(
          `Payment failed for ${chunkId}${amount ? ` · ${amount}` : ''}: ${
            err instanceof Error ? err.message : String(err)
          }`,
          'error'
        )
      },
    }),
    [appendLog]
  )

  const onWrongChain = chainId !== null && chainId !== TARGET_CHAIN_ID
  const defaultTokenAddress = config.defaultTokenAddress
  const primaryCollateral =
    collateral.find(c => defaultTokenAddress && c.asset.toLowerCase() === defaultTokenAddress.toLowerCase()) ??
    collateral[0] ??
    null

  if (!hasTriedEager) {
    return <BootstrapLoader />
  }

  return (
    <div className='relative min-h-screen bg-gradient-to-br from-slate-950 via-indigo-950 to-slate-900 flex items-center justify-center p-6 overflow-hidden'>
      <div className='absolute -top-40 -right-24 h-80 w-80 bg-indigo-500/30 blur-3xl rounded-full pointer-events-none' />
      <div className='absolute -bottom-32 -left-10 h-80 w-80 bg-emerald-500/20 blur-3xl rounded-full pointer-events-none' />

      <div className='w-full max-w-6xl'>
        <div className='mb-4'>
          <h1 className='text-4xl md:text-5xl font-bold text-white tracking-tight drop-shadow-lg'>
            Polygon streaming access
          </h1>
          <p className='text-gray-200 text-base md:text-lg mt-3 leading-relaxed max-w-4xl'>
            Video is served by decentralized operators who get paid for each chunk delivered. Payments run through either
            x402 (direct on-chain) or a 4mica line of credit—swap between them to see the effect.
          </p>
        </div>

        {isConnected ? (
          <div className='grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]'>
            {/* Left column: Video + Activity Log */}
            <div className='flex flex-col gap-6'>
              {onWrongChain ? (
                <NetworkSwitchBanner
                  chainId={chainId}
                  isConnecting={isConnecting}
                  onSwitchNetwork={switchToTargetChain}
                />
              ) : (
                <div className='bg-black rounded-lg overflow-hidden shadow-2xl'>
                  <VideoPlayer
                    src={config.playlistUrl}
                    onReady={handlePlayerReady}
                    paymentHandler={paymentHandler}
                    paymentEvents={paymentEvents}
                  />
                </div>
              )}

              <ActivityLog logs={logs} />
            </div>

            {/* Right column: Wallet Sidebar */}
            <WalletSidebar
              address={address}
              chainId={chainId}
              balance={balance}
              balanceLoading={balanceLoading}
              tokenBalances={tokenBalances}
              collateral={collateral}
              collateralLoading={collateralLoading}
              primaryCollateral={primaryCollateral}
              paymentScheme={paymentScheme}
              onWrongChain={onWrongChain}
              onCopyAddress={copyAddress}
              onSchemeChange={setPaymentScheme}
              onSwitchNetwork={switchToTargetChain}
            />
          </div>
        ) : error ? (
          <div className='bg-gray-900 border border-gray-700 rounded-2xl p-8 shadow-2xl space-y-4 max-w-2xl'>
            <div className='inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-gray-800 border border-gray-600 text-xs uppercase tracking-wider text-red-200'>
              <span className='h-2 w-2 rounded-full bg-red-500 animate-pulse' />
              Signer offline
            </div>
            <div className='text-white text-xl font-semibold'>Signer not found</div>
            <p className='text-gray-300 text-sm leading-relaxed'>
              We could not reach the backend signer for this public demo. Start it locally with your key and retry the
              connection.
            </p>
            <div className='flex items-center gap-3 flex-wrap'>
              <button
                onClick={handleConnect}
                disabled={isConnecting}
                className='px-4 py-3 rounded-lg bg-indigo-600 text-white font-semibold hover:bg-indigo-500 transition disabled:opacity-60 cursor-pointer'
              >
                {isConnecting ? 'Reconnecting…' : 'Retry signer connection'}
              </button>
              <span className='text-xs text-gray-400'>
                Status: {isConnecting ? 'Reconnecting to signer' : 'Awaiting signer'}
              </span>
            </div>
          </div>
        ) : (
          <div className='bg-gray-900 border border-gray-700 rounded-2xl p-8 shadow-2xl space-y-6'>
            <div className='flex items-start justify-between gap-4 flex-wrap'>
              <div>
                <div className='inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-gray-800 border border-gray-600 text-xs uppercase tracking-wider text-indigo-200'>
                  <span className='h-2 w-2 rounded-full bg-emerald-400 animate-pulse' />
                  Backend signer
                </div>
                <div className='text-white text-xl font-semibold mt-3'>Start the signing service</div>
                <p className='text-gray-300 text-sm leading-relaxed mt-2 max-w-2xl'>
                  The private key now lives on a backend signer so it never ships to the browser. Run the signer service
                  with SIGNER_PRIVATE_KEY set, then retry below.
                </p>
              </div>
              <div className='px-3 py-1.5 rounded-full text-xs bg-gray-800 border border-gray-600 text-gray-200'>
                {isConnecting ? 'Connecting…' : 'Waiting for signer'}
              </div>
            </div>

            <div className='grid md:grid-cols-2 gap-4'>
              <div className='rounded-xl border border-gray-800 bg-gray-800 p-5 space-y-3'>
                <div className='text-gray-200 font-semibold'>Environment checks</div>
                <div className='text-sm text-gray-300 flex items-center justify-between'>
                  <span>Signer URL</span>
                  <span className='text-gray-100 break-all'>{config.signerServiceUrl}</span>
                </div>
                <div className='text-sm text-gray-300 flex items-center justify-between'>
                  <span>RPC</span>
                  <span className='text-gray-100 break-all'>{config.rpcProxyUrl}</span>
                </div>
                <div className='text-xs text-emerald-200 mt-2'>
                  The app will use the backend signer for all on-chain payments.
                </div>
              </div>

              <div className='rounded-xl border border-gray-800 bg-gray-800 p-5 space-y-3'>
                <div className='text-gray-200 font-semibold'>How to run it</div>
                <p className='text-sm text-gray-300'>
                  From the repo root, start the signer service with your key:
                </p>
                <pre className='bg-gray-950 border border-gray-800 rounded-lg text-xs text-gray-200 p-3 overflow-auto'>
                  SIGNER_PRIVATE_KEY=0xyourkey npm run signer
                </pre>
                <button
                  onClick={handleConnect}
                  disabled={isConnecting}
                  className='w-full px-4 py-3 rounded-lg bg-indigo-600 text-white font-semibold hover:bg-indigo-500 transition disabled:opacity-60 cursor-pointer'
                >
                  {isConnecting ? 'Connecting…' : 'Retry signer connection'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

    </div>
  )
}

export default App
