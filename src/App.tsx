import { useCallback, useMemo, useState } from 'react'
import type Player from 'video.js/dist/types/player'
import VideoPlayer from './components/VideoPlayer'
import BootstrapLoader from './components/BootstrapLoader'
import ConnectScreen from './components/ConnectScreen'
import WalletSidebar from './components/WalletSidebar'
import ActivityLog from './components/ActivityLog'
import NetworkSwitchBanner from './components/NetworkSwitchBanner'
import { config } from './config/env'
import { TARGET_CHAIN_ID, useWallet } from './context/WalletContext'
import { createPaymentHandler, type PaymentScheme, type SchemeResolvedInfo } from './utils/paymentHandler'
import { useActivityLog, useWalletBalance, useCollateral, use4MicaParams, useDeposit } from './hooks'

function App() {
  const {
    address,
    chainId,
    isConnecting,
    hasTriedEager,
    error,
    isConnected,
    connect,
    disconnect,
    signer,
    switchToTargetChain,
  } = useWallet()

  const [depositAmount, setDepositAmount] = useState('10')
  const [depositMode, setDepositMode] = useState<'default' | 'custom'>('default')
  const [tokenAddress, setTokenAddress] = useState('')
  const [tokenDecimals, setTokenDecimals] = useState('18')
  const [paymentScheme, setPaymentScheme] = useState<PaymentScheme>('4mica-credit')

  const { logs, appendLog } = useActivityLog()
  const { coreParams, paramsLoading } = use4MicaParams(isConnected, appendLog)

  const trackedTokens = useMemo(() => {
    const tokens = new Set<string>()
    if (config.defaultTokenAddress) tokens.add(config.defaultTokenAddress.toLowerCase())
    if (depositMode === 'custom' && tokenAddress) tokens.add(tokenAddress.toLowerCase())
    return Array.from(tokens)
  }, [depositMode, tokenAddress])

  const { balance, balanceLoading, tokenBalances, fetchBalance } = useWalletBalance(
    signer,
    address,
    isConnected,
    chainId,
    trackedTokens,
    appendLog
  )

  const { collateral, collateralLoading, fetchCollateral } = useCollateral(
    signer,
    address,
    isConnected,
    coreParams,
    appendLog
  )

  const { depositLoading, handleDeposit: performDeposit } = useDeposit(
    signer,
    address,
    chainId,
    paymentScheme,
    coreParams,
    appendLog,
    () => {
      fetchBalance()
      fetchCollateral()
    }
  )

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

  const getSigner = useCallback(async () => signer, [signer])

  const paymentHandler = useMemo(
    () => createPaymentHandler(getSigner, getPreferredScheme, handleSchemeResolved),
    [getSigner, getPreferredScheme, handleSchemeResolved]
  )

  const paymentEvents = useMemo(
    () => ({
      onPaymentRequested: (chunkId: string, amount?: string) =>
        appendLog(`#${chunkId} ${amount ? `${amount}` : ''}`, 'warn'),
      onPaymentSettled: (chunkId: string, amount?: string, txHash?: string) =>
        appendLog(`#${chunkId} ${amount ? `${amount}` : 'Settled'}`, 'success', txHash),
      onPaymentFailed: (chunkId: string, err: unknown, amount?: string) =>
        appendLog(
          `Payment failed for ${chunkId}${amount ? ` · ${amount}` : ''}: ${
            err instanceof Error ? err.message : String(err)
          }`,
          'error'
        ),
    }),
    [appendLog]
  )

  const handleDeposit = () => {
    performDeposit(depositMode, depositAmount, tokenAddress, tokenDecimals)
  }

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
        <div className='mb-6'>
          <h1 className='text-2xl font-light text-gray-100 tracking-wide'>Polygon streaming access</h1>
          <p className='text-gray-400 text-sm mt-2 leading-relaxed'>
            Use your wallet to enter the live demo; signatures stay automatic while you watch.
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
              depositMode={depositMode}
              depositAmount={depositAmount}
              tokenAddress={tokenAddress}
              tokenDecimals={tokenDecimals}
              defaultTokenAddress={defaultTokenAddress}
              depositLoading={depositLoading}
              paramsLoading={paramsLoading}
              onWrongChain={onWrongChain}
              onCopyAddress={copyAddress}
              onSchemeChange={setPaymentScheme}
              onDepositModeChange={setDepositMode}
              onDepositAmountChange={setDepositAmount}
              onTokenAddressChange={setTokenAddress}
              onTokenDecimalsChange={setTokenDecimals}
              onDeposit={handleDeposit}
              onSwitchNetwork={switchToTargetChain}
              onDisconnect={disconnect}
            />
          </div>
        ) : (
          <ConnectScreen isConnecting={isConnecting} error={error} onConnect={handleConnect} />
        )}
      </div>
    </div>
  )
}

export default App
