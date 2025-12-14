import { useCallback, useEffect, useMemo, useState } from 'react'
import { formatUnits, ZeroAddress } from 'ethers'
import * as fourMica from 'sdk-4mica'
import type Player from 'video.js/dist/types/player'
import VideoPlayer from './components/VideoPlayer'
import BootstrapLoader from './components/BootstrapLoader'
import ConnectScreen from './components/ConnectScreen'
import WalletSidebar from './components/WalletSidebar'
import ActivityLog from './components/ActivityLog'
import NetworkSwitchBanner from './components/NetworkSwitchBanner'
import TabSettlementPrompt from './components/TabSettlementPrompt'
import { config } from './config/env'
import { TARGET_CHAIN_ID, useWallet } from './context/WalletContext'
import {
  createPaymentHandler,
  type PaymentScheme,
  type SchemeResolvedInfo,
  type PaymentTabInfo,
} from './utils/paymentHandler'
import { useActivityLog, useWalletBalance, useCollateral, use4MicaParams, useDeposit, useClient } from './hooks'

type OpenTabState = {
  tabId: bigint
  assetAddress: string
  recipientAddress: string
  decimals: number
  symbol: string
}

const tabIdToHex = (tabId: bigint) => `0x${tabId.toString(16)}`

const formatTabId = (tabId: bigint) => {
  const hex = tabIdToHex(tabId)
  return hex.length > 20 ? `${hex.slice(0, 10)}…${hex.slice(-6)}` : hex
}

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
  const [openTab, setOpenTab] = useState<OpenTabState | null>(null)
  const [tabReqId, setTabReqId] = useState<bigint | null>(null)
  const [tabDueAmount, setTabDueAmount] = useState<bigint | null>(null)
  const [tabDueDisplay, setTabDueDisplay] = useState('')
  const [tabTotalDisplay, setTabTotalDisplay] = useState('')
  const [showSettlePrompt, setShowSettlePrompt] = useState(false)
  const [settlingTab, setSettlingTab] = useState(false)

  const { logs, appendLog } = useActivityLog()
  const { coreParams, paramsLoading } = use4MicaParams(isConnected, appendLog)
  const { client: sdkClient } = useClient(appendLog)

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

  const { collateral, collateralLoading, fetchCollateral } = useCollateral(isConnected, appendLog)

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

  const handleTabObserved = useCallback((tab: PaymentTabInfo) => {
    setOpenTab(() => {
      return {
        tabId: tab.tabId,
        assetAddress: tab.assetAddress,
        recipientAddress: tab.recipientAddress,
        decimals: tab.decimals,
        symbol: tab.symbol,
      }
    })
    setTabReqId(null)
    setTabDueAmount(null)
    setTabDueDisplay('')
    setTabTotalDisplay('')
  }, [])

  const getSigner = useCallback(async () => signer, [signer])

  const paymentHandler = useMemo(
    () => createPaymentHandler(getSigner, getPreferredScheme, handleSchemeResolved, handleTabObserved),
    [getSigner, getPreferredScheme, handleSchemeResolved, handleTabObserved]
  )

  const tabAmountDisplay = useMemo(
    () => tabTotalDisplay || (openTab ? `${openTab.symbol} due` : ''),
    [openTab, tabTotalDisplay]
  )

  const settleAmountDisplay = useMemo(
    () => tabDueDisplay || (openTab ? `${openTab.symbol} due` : ''),
    [openTab, tabDueDisplay]
  )

  const settleTabLabel = useMemo(() => (openTab ? formatTabId(openTab.tabId) : ''), [openTab])

  const refreshTabDue = useCallback(async () => {
    if (!openTab || !sdkClient) return null

    try {
      const guarantees = await sdkClient.recipient.getTabGuarantees(openTab.tabId)
      if (!guarantees.length) {
        appendLog(`No guarantee found for tab #${tabIdToHex(openTab.tabId)}.`, 'warn')
        setTabReqId(null)
        setTabDueAmount(null)
        setTabDueDisplay('')
        setTabTotalDisplay('')
        return null
      }

      const totalAmount = guarantees.reduce((acc, g) => acc + g.amount, 0n)

      const latest = guarantees[guarantees.length - 1]
      const status = await sdkClient.user.getTabPaymentStatus(openTab.tabId)
      const paid = status?.paid ?? 0n
      const due = totalAmount > paid ? totalAmount - paid : 0n

      setTabReqId(latest.reqId)
      setTabDueAmount(due)
      setTabDueDisplay(`${formatUnits(due, openTab.decimals)} ${openTab.symbol}`)
      setTabTotalDisplay(`${formatUnits(totalAmount, openTab.decimals)} ${openTab.symbol}`)

      setOpenTab(prev =>
        prev
          ? {
              ...prev,
              assetAddress: latest.assetAddress || prev.assetAddress,
              recipientAddress: latest.toAddress || prev.recipientAddress,
            }
          : prev
      )

      return { due, reqId: latest.reqId }
    } catch (err) {
      appendLog(`Failed to fetch tab balance: ${err instanceof Error ? err.message : String(err)}`, 'error')
      setTabReqId(null)
      setTabDueAmount(null)
      setTabDueDisplay('')
      setTabTotalDisplay('')
      return null
    }
  }, [openTab, sdkClient])

  const paymentEvents = useMemo(
    () => ({
      onPaymentRequested: (chunkId: string, amount?: string) => {
        appendLog(`#${chunkId} ${amount ? `${amount}` : ''}`, 'warn')
        void refreshTabDue()
      },
      onPaymentSettled: (chunkId: string, amount?: string, txHash?: string) => {
        appendLog(`#${chunkId} ${amount ? `${amount}` : 'Settled'}`, 'success', txHash)
        void refreshTabDue()
      },
      onPaymentFailed: (chunkId: string, err: unknown, amount?: string) => {
        appendLog(
          `Payment failed for ${chunkId}${amount ? ` · ${amount}` : ''}: ${
            err instanceof Error ? err.message : String(err)
          }`,
          'error'
        )
        void refreshTabDue()
      },
    }),
    [refreshTabDue]
  )

  const ensureTabAllowance = useCallback(
    async (client: fourMica.Client, amount: bigint) => {
      if (!openTab) return
      if (openTab.assetAddress.toLowerCase() === ZeroAddress.toLowerCase()) {
        appendLog('Native-asset tabs are not supported for quick settlement in this demo.', 'warn')
        throw new Error('native-asset-tab')
      }

      if (amount <= 0n) {
        appendLog('No outstanding allowance needed for this tab.', 'info')
        return
      }
      const amountLabel = amount > 0n ? `${formatUnits(amount, openTab.decimals)} ${openTab.symbol}` : ''

      try {
        await client.user.approveErc20(openTab.assetAddress, amount)
        appendLog(`Approval ready for ${amountLabel}`)
        return
      } catch (err) {
        appendLog(
          `Approval failed (will retry with reset): ${err instanceof Error ? err.message : String(err)}`,
          'warn'
        )
      }

      try {
        await client.user.approveErc20(openTab.assetAddress, 0n)
        await client.user.approveErc20(openTab.assetAddress, amount)
        appendLog(`Approval refreshed for ${amountLabel || 'tab amount'}`)
      } catch (err) {
        appendLog(
          `Approval retry failed: ${err instanceof Error ? err.message : String(err)}. Approve manually then retry.`,
          'error'
        )
        throw err
      }
    },
    [openTab]
  )

  const handleSettleTab = useCallback(async () => {
    if (!openTab || !sdkClient) return
    if (!coreParams) {
      appendLog('Missing 4mica contract parameters; try again in a moment.', 'error')
      return
    }

    setSettlingTab(true)
    try {
      const dueInfo = (await refreshTabDue()) ?? null
      const due = dueInfo?.due ?? tabDueAmount ?? 0n
      const reqId = dueInfo?.reqId ?? tabReqId

      if (!reqId || due <= 0n) {
        appendLog('No outstanding balance to settle.', 'info')
        setOpenTab(null)
        setShowSettlePrompt(false)
        return
      }

      await ensureTabAllowance(sdkClient, due)
      appendLog(`Settling 4mica tab #${settleTabLabel} for ${settleAmountDisplay || 'the outstanding amount'}…`)

      const receipt: any = await sdkClient.user.payTab(
        openTab.tabId,
        reqId,
        due,
        openTab.recipientAddress,
        openTab.assetAddress
      )
      const txHash = receipt?.transactionHash || receipt?.hash || undefined
      appendLog(`Tab #${tabIdToHex(openTab.tabId)} settled.`, 'success', txHash)
      setOpenTab(null)
      setTabReqId(null)
      setTabDueAmount(null)
      setTabDueDisplay('')
      setTabTotalDisplay('')
      setShowSettlePrompt(false)
    } catch (err) {
      appendLog(`Tab settlement failed: ${err instanceof Error ? err.message : String(err)}`, 'error')
    } finally {
      setSettlingTab(false)
    }
  }, [
    openTab,
    sdkClient,
    coreParams,
    appendLog,
    settleAmountDisplay,
    ensureTabAllowance,
    tabDueAmount,
    tabReqId,
    refreshTabDue,
    settleTabLabel,
  ])

  const handleDeposit = () => {
    performDeposit(depositMode, depositAmount, tokenAddress, tokenDecimals)
  }

  useEffect(() => {
    if (!isConnected) {
      setOpenTab(null)
      setTabReqId(null)
      setTabDueAmount(null)
      setTabDueDisplay('')
      setTabTotalDisplay('')
      setShowSettlePrompt(false)
      setSettlingTab(false)
    }
  }, [isConnected])

  useEffect(() => {
    if (openTab && sdkClient) {
      refreshTabDue()
    }
  }, [openTab?.tabId, sdkClient])

  useEffect(() => {
    if (!openTab || !tabDueAmount || tabDueAmount <= 0n) return
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      setShowSettlePrompt(true)
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [openTab, tabDueAmount])

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
              openTab={openTab}
              tabLabel={settleTabLabel}
              tabAmountLabel={tabAmountDisplay}
              settlingTab={settlingTab}
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
              onSettleTab={handleSettleTab}
              onShowSettlePrompt={() => setShowSettlePrompt(true)}
            />
          </div>
        ) : (
          <ConnectScreen isConnecting={isConnecting} error={error} onConnect={handleConnect} />
        )}
      </div>

      {openTab && (
        <TabSettlementPrompt
          tabLabel={settleTabLabel}
          amountLabel={settleAmountDisplay || `${openTab.symbol} balance`}
          visible={showSettlePrompt}
          settling={settlingTab}
          onSettle={handleSettleTab}
          onDismiss={() => setShowSettlePrompt(false)}
        />
      )}
    </div>
  )
}

export default App
