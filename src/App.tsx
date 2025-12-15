import { useCallback, useEffect, useMemo, useState } from 'react'
import { formatUnits, ZeroAddress, isAddress } from 'ethers'
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
import { getCoreContract, getErc20Contract } from './utils/fourMicaContract'
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
  const { logs, appendLog: rawAppendLog } = useActivityLog()
  const appendLog = useCallback(
    (entry: string, tone?: 'info' | 'warn' | 'success' | 'error', txHash?: string) => {
      const lower = entry.toLowerCase()
      const isPayment =
        lower.includes('payment requested') || lower.includes('payment settled') || lower.includes('payment failed')
      const isDeposit = lower.includes('deposit')
      const isTab = lower.includes('tab ')
      if (isPayment || isDeposit || isTab) {
        rawAppendLog(entry, tone, txHash)
      } else {
        console.info('[log suppressed]', entry)
      }
    },
    [rawAppendLog]
  )
  const { client: sdkClient } = useClient(appendLog)
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
  }, [openTab, sdkClient, appendLog])

  const paymentEvents = useMemo(
    () => ({
      onPaymentRequested: (chunkId: string, amount?: string) => {
        appendLog(`Payment requested (#${chunkId}${amount ? ` · ${amount}` : ''})`, 'warn')
        void refreshTabDue()
      },
      onPaymentSettled: (chunkId: string, amount?: string, txHash?: string) => {
        appendLog(`Payment settled (#${chunkId}${amount ? ` · ${amount}` : ''})`, 'success', txHash)
        void refreshTabDue()
      },
      onPaymentFailed: (chunkId: string, err: unknown, amount?: string) => {
        appendLog(
          `Payment failed (#${chunkId}${amount ? ` · ${amount}` : ''})`,
          'error'
        )
        void refreshTabDue()
      },
    }),
    [refreshTabDue]
  )

  const ensureTabAllowance = useCallback(
    async (amount: bigint) => {
      if (!openTab) return
      if (!signer || !address) {
        appendLog('Connect your wallet before settling.', 'error')
        throw new Error('missing-signer')
      }
      if (!coreParams?.contractAddress || !isAddress(coreParams.contractAddress)) {
        appendLog('Missing 4mica contract address; reload params and try again.', 'error')
        throw new Error('missing-contract')
      }
      if (openTab.assetAddress.toLowerCase() === ZeroAddress.toLowerCase()) {
        appendLog('Native-asset tabs are not supported for quick settlement in this demo.', 'warn')
        throw new Error('native-asset-tab')
      }

      if (amount <= 0n) {
        appendLog('No outstanding allowance needed for this tab.', 'info')
        return
      }
      const amountLabel = `${formatUnits(amount, openTab.decimals)} ${openTab.symbol}`

      const erc20 = getErc20Contract(openTab.assetAddress, signer)
      const currentAllowance: bigint = await erc20.allowance(address, coreParams.contractAddress)
      if (currentAllowance >= amount) {
        appendLog('Existing allowance is sufficient for settlement.')
        return
      }

      try {
        const tx = await erc20.approve(coreParams.contractAddress, amount)
        const receipt = await tx.wait?.(1)
        appendLog(`Approval ready for ${amountLabel}`, 'success', receipt?.hash || tx.hash)
        return
      } catch (err) {
        appendLog(
          `Approval failed (will retry with reset): ${err instanceof Error ? err.message : String(err)}`,
          'warn'
        )
      }

      try {
        const resetTx = await erc20.approve(coreParams.contractAddress, 0n)
        await resetTx.wait?.(1)
        const tx = await erc20.approve(coreParams.contractAddress, amount)
        const receipt = await tx.wait?.(1)
        appendLog(`Approval refreshed for ${amountLabel || 'tab amount'}`, 'success', receipt?.hash || tx.hash)
      } catch (err) {
        appendLog(
          `Approval retry failed: ${err instanceof Error ? err.message : String(err)}. Approve manually then retry.`,
          'error'
        )
        throw err
      }
    },
    [openTab, signer, address, coreParams?.contractAddress, appendLog]
  )

  const handleSettleTab = useCallback(async () => {
    if (!openTab) return
    if (!signer || !address) {
      appendLog('Connect your wallet before settling.', 'error')
      return
    }
    if (!coreParams?.contractAddress || !isAddress(coreParams.contractAddress)) {
      appendLog('Missing 4mica contract parameters; try again in a moment.', 'error')
      return
    }

    const requiredChainId = coreParams?.chainId ?? TARGET_CHAIN_ID
    if (chainId !== null && chainId !== requiredChainId) {
      appendLog(`Switch to chain ${requiredChainId} before settling.`, 'warn')
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

      if (openTab.assetAddress.toLowerCase() === ZeroAddress.toLowerCase()) {
        appendLog('Native-asset tabs are not supported for quick settlement in this demo.', 'warn')
        return
      }

      await ensureTabAllowance(due)
      appendLog(`Settling 4mica tab #${settleTabLabel} for ${settleAmountDisplay || 'the outstanding amount'}…`)

      const core = getCoreContract(coreParams.contractAddress, signer)
      const tx = await core.payTabInERC20Token(openTab.tabId, openTab.assetAddress, due, openTab.recipientAddress)
      const receipt = await tx.wait?.(1)
      const txHash = receipt?.hash || tx?.hash || undefined
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
    signer,
    address,
    coreParams?.contractAddress,
    coreParams?.chainId,
    chainId,
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
    if (openTab) {
      refreshTabDue()
    }
  }, [openTab?.tabId, refreshTabDue])

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
