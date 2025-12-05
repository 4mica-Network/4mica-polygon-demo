import { useCallback, useEffect, useMemo, useState } from 'react'
import type Player from 'video.js/dist/types/player'
import { Contract, formatEther, formatUnits, isAddress, parseUnits } from 'ethers'
import VideoPlayer from './components/VideoPlayer'
import { config } from './config/env'
import { TARGET_CHAIN_ID, useWallet } from './context/WalletContext'
import { createPaymentHandler, type PaymentScheme, type SchemeResolvedInfo } from './utils/paymentHandler'
import core4micaAbi from 'sdk-4mica/dist/abi/core4mica.json'
import * as fourMica from 'sdk-4mica'

const boundFetch = (input: RequestInfo | URL, init?: RequestInit) => {
  const f = globalThis.fetch as any
  if (typeof f !== 'function') throw new Error('global fetch not available')
  return f.call(globalThis, input, init)
}

function App() {
  const [playerReady, setPlayerReady] = useState<boolean>(false)
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
  const [balance, setBalance] = useState<string | null>(null)
  const [balanceLoading, setBalanceLoading] = useState(false)
  const [depositAmount, setDepositAmount] = useState('10')
  const [depositMode, setDepositMode] = useState<'default' | 'custom'>('default')
  const [tokenAddress, setTokenAddress] = useState('')
  const [tokenDecimals, setTokenDecimals] = useState('18')
  const [depositLoading, setDepositLoading] = useState(false)
  const [paymentScheme, setPaymentScheme] = useState<PaymentScheme>('4mica-credit')
  type LogTone = 'info' | 'warn' | 'success' | 'error'
  type LogEntry = { text: string; tone: LogTone; at: string; txHash?: string }
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [coreParams, setCoreParams] = useState<fourMica.CorePublicParameters | null>(null)
  const [paramsLoading, setParamsLoading] = useState(false)
  const [tokenBalances, setTokenBalances] = useState<
    { address: string; symbol: string; balance: string; decimals: number }[]
  >([])
  const [collateral, setCollateral] = useState<
    { asset: string; symbol: string; decimals: number; collateral: string; withdrawalRequested: string }[]
  >([])
  const [collateralLoading, setCollateralLoading] = useState(false)

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

  const appendLog = useCallback((entry: string, tone: LogTone = 'info', txHash?: string) => {
    setLogs(prev => {
      const next = [{ text: entry, tone, at: new Date().toLocaleTimeString(), txHash }, ...prev]
      return next.slice(0, 100)
    })
  }, [])

  const getPreferredScheme = useCallback(() => paymentScheme, [paymentScheme])

  const handleSchemeResolved = useCallback(
    ({ preferred, chosen, offered, usedFallback }: SchemeResolvedInfo) => {
      if (usedFallback && chosen.toLowerCase() !== preferred.toLowerCase()) {
        const offeredList = offered.filter(Boolean).join(', ')
        appendLog(
          `Payment rail ${preferred} unavailable; using ${chosen || 'fallback'}${offeredList ? ` (offered: ${offeredList})` : ''}.`,
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
          `Payment failed for ${chunkId}${amount ? ` · ${amount}` : ''}: ${err instanceof Error ? err.message : String(err)}`,
          'error'
        ),
    }),
    [appendLog]
  )

  const formatAddress = (addr: string | null | undefined) => {
    if (!addr) return '—'
    const prefix = addr.slice(0, 6)
    const suffix = addr.slice(-4)
    return `${prefix}...${suffix}`
  }

  const formatTxHash = (hash?: string) => {
    if (!hash) return ''
    if (hash.length <= 18) return hash
    return `${hash.slice(0, 10)}...${hash.slice(-6)}`
  }

  const explorerUrlForTx = (hash?: string) => (hash ? `https://amoy.polygonscan.com/tx/${hash}` : null)

  const copyAddress = useCallback(async () => {
    if (!address) {
      appendLog('No wallet connected to copy.')
      return
    }
    try {
      await navigator.clipboard?.writeText(address)
      appendLog('Wallet address copied.')
    } catch (err) {
      appendLog(`Copy failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }, [address, appendLog])

  const fetchBalance = useCallback(async () => {
    if (!signer || !address) return
    setBalanceLoading(true)
    try {
      const bal = await signer.provider?.getBalance(address)
      if (bal !== undefined) {
        setBalance(formatEther(bal))
      }
    } catch (err) {
      appendLog(`Balance fetch failed: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setBalanceLoading(false)
    }
  }, [signer, address, appendLog])

  useEffect(() => {
    if (!isConnected) {
      setBalance(null)
      setTokenBalances([])
      return
    }
    fetchBalance()
  }, [isConnected, chainId, fetchBalance])

  useEffect(() => {
    let active = true
    const loadParams = async () => {
      if (!isConnected) return
      setParamsLoading(true)
      try {
        const rpc = new fourMica.RpcProxy(config.rpcUrl, undefined, boundFetch as any)
        const p = await rpc.getPublicParams()
        if (active) setCoreParams(p)
      } catch (err) {
        appendLog(`Failed to load 4mica params: ${err instanceof Error ? err.message : String(err)}`)
      } finally {
        if (active) setParamsLoading(false)
      }
    }
    loadParams()
    return () => {
      active = false
    }
  }, [isConnected, appendLog])

  const trackedTokens = useMemo(() => {
    const tokens = new Set<string>()
    if (config.defaultTokenAddress) tokens.add(config.defaultTokenAddress.toLowerCase())
    if (depositMode === 'custom' && tokenAddress) tokens.add(tokenAddress.toLowerCase())
    return Array.from(tokens)
  }, [depositMode, tokenAddress])

  useEffect(() => {
    let cancelled = false
    const fetchTokenBalances = async () => {
      if (!signer || !isConnected || trackedTokens.length === 0) {
        setTokenBalances([])
        return
      }
      const provider = signer.provider
      if (!provider) return

      const results: { address: string; symbol: string; balance: string; decimals: number }[] = []
      for (const addr of trackedTokens) {
        try {
          const erc20 = new Contract(
            addr,
            ['function symbol() view returns (string)', 'function decimals() view returns (uint8)', 'function balanceOf(address) view returns (uint256)'],
            provider
          )
          const [symbol, decimalsValue, raw] = await Promise.all([
            erc20.symbol(),
            erc20.decimals(),
            erc20.balanceOf(address),
          ])
          results.push({
            address: addr,
            symbol,
            decimals: Number(decimalsValue),
            balance: formatUnits(raw, decimalsValue),
          })
        } catch (err) {
          appendLog(`Token balance failed for ${addr}: ${err instanceof Error ? err.message : String(err)}`)
        }
      }
      if (!cancelled) {
        setTokenBalances(results)
      }
    }
    fetchTokenBalances()
    return () => {
      cancelled = true
    }
  }, [signer, isConnected, trackedTokens, address, appendLog])

  const resolveTokenMeta = useCallback(
    async (tokenAddr: string) => {
      if (!signer?.provider) {
        throw new Error('Wallet provider unavailable')
      }
      const erc20 = new Contract(
        tokenAddr,
        ['function symbol() view returns (string)', 'function decimals() view returns (uint8)'],
        signer.provider
      )
      try {
        const [symbol, decimalsValue] = await Promise.all([erc20.symbol(), erc20.decimals()])
        return { symbol: String(symbol), decimals: Number(decimalsValue) || 18 }
      } catch (err) {
        appendLog(`Token metadata fetch failed for ${tokenAddr}: ${err instanceof Error ? err.message : String(err)}`)
        return null
      }
    },
    [signer, appendLog]
  )

  const fetchCollateral = useCallback(async () => {
    if (!coreParams || !address || !signer?.provider) return
    setCollateralLoading(true)
    try {
      const contract = new Contract(
        coreParams.contractAddress,
        (core4micaAbi as any).abi ?? core4micaAbi,
        signer.provider
      )
      const raw: any[] = await contract.getUserAllAssets(address)
      const parsed = await Promise.all(
        raw.map(async item => {
          const assetAddr = String(item.asset ?? item[0] ?? '')
          const zeroAddress = '0x0000000000000000000000000000000000000000'
          if (!assetAddr || !isAddress(assetAddr)) return null
          const collateralRaw = BigInt(item.collateral ?? item[1] ?? 0)
          const withdrawalRaw = BigInt(item.withdrawal_request_amount ?? item[3] ?? 0)
          const isNative = assetAddr.toLowerCase() === zeroAddress
          const meta = isNative ? { symbol: 'POL', decimals: 18 } : await resolveTokenMeta(assetAddr)
          const decimals = meta?.decimals ?? 18
          const symbol = meta?.symbol ?? `${assetAddr.slice(0, 6)}...${assetAddr.slice(-4)}`
          return {
            asset: assetAddr,
            symbol,
            decimals,
            collateral: formatUnits(collateralRaw, decimals),
            withdrawalRequested: formatUnits(withdrawalRaw, decimals),
          }
        })
      )
      setCollateral(parsed.filter(Boolean) as typeof collateral)
    } catch (err) {
      appendLog(`Collateral fetch failed: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setCollateralLoading(false)
    }
  }, [coreParams, address, signer, resolveTokenMeta, appendLog])

  useEffect(() => {
    if (isConnected) {
      fetchCollateral()
    } else {
      setCollateral([])
    }
  }, [isConnected, fetchCollateral])

  useEffect(() => {
    if (!isConnected) return
    const id = setInterval(() => {
      fetchCollateral()
    }, 10000)
    return () => clearInterval(id)
  }, [isConnected, fetchCollateral])

  const ensureAllowance = useCallback(
    async (tokenAddr: string, required: bigint, decimals: number) => {
      if (!signer || !address || !coreParams) {
        throw new Error('Wallet not ready for approval')
      }

      const erc20 = new Contract(
        tokenAddr,
        [
          'function allowance(address owner, address spender) view returns (uint256)',
          'function approve(address spender, uint256 amount) returns (bool)',
        ],
        signer
      )
      const current: bigint = await erc20.allowance(address, coreParams.contractAddress)
      if (current >= required) {
        appendLog('Existing allowance is sufficient; skipping approval.')
        return
      }

      appendLog(`Requesting token approval for ${formatUnits(required, decimals)}…`)
      const approveTx = await erc20.approve(coreParams.contractAddress, required)
      appendLog(`Approve submitted: ${approveTx.hash}`)
      const receipt = await approveTx.wait()
      appendLog(`Approve confirmed in block ${receipt?.blockNumber ?? 'unknown'}`)
    },
    [signer, address, coreParams, appendLog]
  )

  const handleDeposit = async () => {
    if (!signer || !address) {
      appendLog('Connect wallet before depositing.')
      return
    }
    if (paymentScheme !== '4mica-credit') {
      appendLog('Deposits are only needed in 4mica credit mode. Switch payment rail to deposit.')
      return
    }
    if (!coreParams) {
      appendLog('Missing 4mica contract parameters; try again.')
      return
    }
    const requiredChainId = coreParams.chainId ?? TARGET_CHAIN_ID
    if (chainId !== requiredChainId) {
      appendLog(`Switch to chain ${requiredChainId} before depositing.`)
      return
    }
    const amount = depositAmount.trim()
    if (!amount || Number(amount) <= 0) {
      appendLog('Enter a valid amount greater than 0.')
      return
    }
    const useDefaultToken = depositMode === 'default'
    const defaultTokenAddress = config.defaultTokenAddress

    if (useDefaultToken && (!defaultTokenAddress || !isAddress(defaultTokenAddress))) {
      appendLog('Default token address not configured or invalid. Please enter a token address.')
      return
    }

    if (!useDefaultToken && !tokenAddress) {
      appendLog('Enter a token address.')
      return
    }
    if (!useDefaultToken && !isAddress(tokenAddress)) {
      appendLog('Enter a valid token address.')
      return
    }

    setDepositLoading(true)
    try {
      const contract = new Contract(
        coreParams.contractAddress,
        (core4micaAbi as any).abi ?? core4micaAbi,
        signer
      )

      const tokenToUse = useDefaultToken ? defaultTokenAddress : tokenAddress
      const meta = await resolveTokenMeta(tokenToUse)
      const decimals = meta?.decimals ?? (useDefaultToken ? 6 : Number(tokenDecimals) || 18)
      const parsedAmount = parseUnits(amount, decimals)
      const tokenLabel = meta?.symbol ?? tokenToUse
      appendLog(`Preparing deposit of ${formatUnits(parsedAmount, decimals)} ${tokenLabel} (${decimals} decimals)`)

      await ensureAllowance(tokenToUse, parsedAmount, decimals)

      let tx
      if (useDefaultToken) {
        tx = await contract.depositStablecoin(defaultTokenAddress, parsedAmount)
        appendLog(`Deposit submitted (USDC default): ${tx.hash}`)
      } else {
        tx = await contract.depositStablecoin(tokenAddress, parsedAmount)
        appendLog(`Deposit submitted (custom token ${tokenLabel}): ${tx.hash}`)
      }
      const receipt = await tx.wait()
      appendLog(`Deposit confirmed in block ${receipt?.blockNumber ?? 'unknown'}`)
      fetchBalance()
      fetchCollateral()
    } catch (err) {
      appendLog(`Deposit failed: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setDepositLoading(false)
    }
  }

  const renderConnectScreen = () => (
    <div className='relative z-10 grid lg:grid-cols-[1.05fr_0.95fr] gap-10 items-center'>
      <div className='space-y-6'>
        <div className='inline-flex items-center gap-2 px-4 py-1 rounded-full bg-white/10 border border-white/15 text-xs uppercase tracking-[0.12em] text-indigo-100'>
          <span className='h-2.5 w-2.5 rounded-full bg-emerald-400 animate-pulse' />
          Live on Polygon Amoy
        </div>
        <div className='space-y-3'>
          <h2 className='text-3xl md:text-4xl text-white font-semibold leading-tight'>Stream instantly with a wallet tap</h2>
          <p className='text-gray-200 text-lg leading-relaxed max-w-2xl'>
            Connect your wallet and start playback without forms or friction. Settlement runs in the background while you stay focused on the stream.
          </p>
        </div>

        <div className='grid sm:grid-cols-3 gap-3'>
          <div className='rounded-2xl border border-white/10 bg-white/5 p-4 shadow-lg shadow-indigo-900/10'>
            <div className='text-[11px] uppercase tracking-[0.14em] text-indigo-100 mb-1.5'>Network check</div>
            <div className='text-white font-semibold flex items-center gap-2 text-sm'>
              <span className='h-2 w-2 rounded-full bg-emerald-400 animate-pulse' />
              Amoy pre-set
            </div>
            <div className='text-xs text-gray-400 mt-2'>Auto-detects the target chain and prompts a switch if needed.</div>
          </div>
          <div className='rounded-2xl border border-white/10 bg-white/5 p-4 shadow-lg shadow-emerald-900/10'>
            <div className='text-[11px] uppercase tracking-[0.14em] text-emerald-100 mb-1.5'>Privacy</div>
            <div className='text-white font-semibold text-sm'>Sign only</div>
            <div className='text-xs text-gray-400 mt-2'>Connection uses message signing; no spending approvals requested here.</div>
          </div>
          <div className='rounded-2xl border border-white/10 bg-white/5 p-4 shadow-lg shadow-blue-900/10'>
            <div className='text-[11px] uppercase tracking-[0.14em] text-blue-100 mb-1.5'>Focus</div>
            <div className='text-white font-semibold text-sm'>Playback first</div>
            <div className='text-xs text-gray-400 mt-2'>Wallet stays connected while x402 handles per-segment payments.</div>
          </div>
        </div>

        <div className='flex items-start gap-3 text-sm text-gray-200 max-w-2xl'>
          <div className='h-10 w-10 rounded-xl bg-white/10 border border-white/10 flex items-center justify-center text-lg'>✓</div>
          <div>
            <div className='font-semibold text-white'>Fast start, clear safety</div>
            <div className='text-gray-400'>
              Single primary action to connect, visible chain badge, and reassurance that keys stay local.
            </div>
          </div>
        </div>
      </div>

      <div className='relative'>
        <div className='absolute -inset-6 bg-gradient-to-br from-indigo-600/25 via-blue-500/15 to-emerald-500/20 blur-3xl opacity-70 rounded-[32px]' />
        <div className='relative bg-slate-950/70 border border-white/10 rounded-[28px] p-7 shadow-[0_25px_70px_rgba(0,0,0,0.45)] backdrop-blur'>
          <div className='flex items-center justify-between mb-6'>
            <div>
              <div className='text-gray-100 text-xl font-semibold'>Connect your wallet</div>
              <div className='text-gray-400 text-sm'>Choose a provider and approve the prompt</div>
            </div>
            <div className='px-3 py-1 rounded-full text-xs bg-white/10 border border-white/20 text-gray-100'>Step 1</div>
          </div>

          <div className='rounded-2xl border border-white/10 bg-gradient-to-br from-slate-900 via-slate-900/70 to-indigo-900/40 p-5 space-y-4'>
            <div className='flex items-center justify-between'>
              <div className='text-sm text-gray-300'>Connection state</div>
              <span className='px-3 py-1 rounded-full text-xs border border-white/10 text-gray-100 bg-white/5'>
                {isConnecting ? 'Awaiting approval…' : 'Ready to connect'}
              </span>
            </div>

            <div className='rounded-xl border border-white/10 bg-black/40 px-4 py-3 flex items-center justify-between'>
              <div>
                <div className='text-[11px] uppercase tracking-[0.14em] text-gray-400'>Chain</div>
                <div className='text-gray-100 font-semibold flex items-center gap-2'>
                  <span className='h-2 w-2 rounded-full bg-emerald-400 animate-pulse' />
                  Polygon Amoy • 80002
                </div>
              </div>
              <div className='text-[11px] px-3 py-1 rounded-full bg-emerald-500/15 text-emerald-100 border border-emerald-500/30'>
                Synced
              </div>
            </div>

            <div className='grid sm:grid-cols-3 gap-2 text-xs text-gray-300'>
              <div className='rounded-lg border border-white/10 bg-white/5 p-3'>
                <div className='font-semibold text-white mb-1'>Pick wallet</div>
                <div className='text-gray-400'>Metamask, WalletConnect, or any injected EVM.</div>
              </div>
              <div className='rounded-lg border border-white/10 bg-white/5 p-3'>
                <div className='font-semibold text-white mb-1'>Approve</div>
                <div className='text-gray-400'>Review and sign the connect request.</div>
              </div>
              <div className='rounded-lg border border-white/10 bg-white/5 p-3'>
                <div className='font-semibold text-white mb-1'>Start streaming</div>
                <div className='text-gray-400'>Playback continues while on-chain payments run.</div>
              </div>
            </div>

            <button
              onClick={handleConnect}
              className='w-full px-5 py-3 rounded-2xl bg-gradient-to-r from-indigo-500 via-blue-500 to-emerald-400 text-white text-base font-semibold shadow-lg shadow-indigo-500/30 hover:shadow-emerald-400/30 transition disabled:opacity-60'
              disabled={isConnecting}
            >
              {isConnecting ? 'Connecting...' : 'Connect wallet'}
            </button>
            {error && <div className='text-sm text-red-400 text-center'>{error}</div>}
            <div className='text-xs text-gray-400 text-center'>No approvals to spend; this step is for access only.</div>
          </div>
        </div>
      </div>
    </div>
  )

  const renderPlayerScreen = () => {
    const onWrongChain = chainId !== null && chainId !== TARGET_CHAIN_ID
    const defaultTokenAddress = config.defaultTokenAddress
    const primaryCollateral =
      collateral.find(c => defaultTokenAddress && c.asset.toLowerCase() === defaultTokenAddress.toLowerCase()) ??
      collateral[0] ??
      null
    return (
      <div className='grid gap-6 lg:grid-cols-[320px_minmax(0,1fr)_320px]'>
        <div className='bg-gray-800/90 border border-white/10 rounded-2xl p-5 shadow-xl flex flex-col gap-4'>
          <div className='rounded-2xl bg-gradient-to-br from-emerald-500/25 via-teal-500/15 to-indigo-600/15 border border-emerald-400/40 p-4 shadow-lg'>
            <div className='flex items-start justify-between gap-3'>
            </div>
            <div className='mt-4 flex items-end justify-between'>
              <div className='text-3xl font-semibold text-white'>
                {primaryCollateral
                  ? `${Number(primaryCollateral.collateral || '0').toLocaleString(undefined, { maximumFractionDigits: 4 })} ${primaryCollateral.symbol}`
                  : '0'}
              </div>
              <div
                className={`px-3 py-1 rounded-full text-xs border ${
                  collateral.length ? 'bg-emerald-500/20 border-emerald-300/50 text-emerald-100' : 'bg-white/10 border-white/20 text-white/80'
                }`}
              >
                {collateralLoading ? 'Syncing' : collateral.length ? 'Live' : 'No collateral'}
              </div>
            </div>
            <div className='text-xs text-emerald-50/80 mt-1'>6% APY</div>
            {primaryCollateral && Number(primaryCollateral.withdrawalRequested) > 0 && (
              <div className='mt-2 text-xs text-amber-100 bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-2'>
                Withdrawal pending: {Number(primaryCollateral.withdrawalRequested).toFixed(4)} {primaryCollateral.symbol}
              </div>
            )}
            <div className='mt-4 grid gap-2'>
              {collateral.length === 0 && (
                <div className='text-sm text-gray-100/90 bg-white/10 border border-white/15 rounded-lg px-3 py-3'>
                  No collateral on 4Mica yet. Deposit to keep playback uninterrupted.
                </div>
              )}
              {collateral.map(item => (
                <div key={item.asset} className='flex items-center justify-between text-sm bg-black/30 border border-white/10 rounded-lg px-3 py-2'>
                  <div className='text-gray-100 font-medium'>{item.symbol}</div>
                  <div className='text-gray-50 font-semibold'>{Number(item.collateral).toFixed(4)}</div>
                </div>
              ))}
            </div>
          </div>

          <div className='rounded-xl bg-white/5 border border-white/10 p-4 space-y-2'>
            <div className='text-sm text-gray-300 flex items-center justify-between'>
              <span>Wallet</span>
              <div className='flex items-center gap-2 text-xs text-gray-200'>
                <span className='font-medium'>{formatAddress(address)}</span>
                <button
                  onClick={copyAddress}
                  className='px-2 py-1 rounded bg-white/10 border border-white/15 text-[11px] text-white hover:bg-white/20 transition'
                >
                  Copy
                </button>
              </div>
            </div>
            <div className='text-sm text-gray-300 flex items-center justify-between'>
              <span>Network</span>
              <span className='px-2 py-1 rounded-full bg-indigo-500/20 text-indigo-100 text-xs'>Polygon Amoy</span>
            </div>
            <div className='text-sm text-gray-300 flex items-center justify-between'>
              <span>Chain ID</span>
              <span className={onWrongChain ? 'text-yellow-300 font-semibold' : 'text-emerald-300 font-semibold'}>{chainId ?? 'Unknown'}</span>
            </div>
            <div className='text-sm text-gray-300 flex items-center justify-between'>
              <span>Wallet balance</span>
              <span className='text-gray-100 font-semibold'>
                {balanceLoading ? 'Loading…' : balance ? `${Number(balance).toFixed(4)} POL` : '—'}
              </span>
            </div>
            {tokenBalances.length > 0 && (
              <div className='text-sm text-gray-300'>
                <div className='mb-1'>Token balances</div>
                <div className='space-y-1'>
                  {tokenBalances.map(tb => (
                    <div key={tb.address} className='flex items-center justify-between text-xs bg-white/5 border border-white/5 rounded px-2 py-1'>
                      <span className='text-gray-200'>{tb.symbol}</span>
                      <span className='text-gray-100 font-semibold'>{Number(tb.balance).toFixed(4)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className='space-y-4'>
            <div className='space-y-3'>
              <div className='text-gray-200 font-semibold flex items-center justify-between'>
                <span>Payment rail</span>
                {paymentScheme === '4mica-credit' ? (
                  <span className='text-xs text-emerald-300'>Recommended</span>
                ) : (
                  <span className='text-xs text-indigo-200'>On-chain</span>
                )}
              </div>
              <div className='grid grid-cols-2 gap-2 text-sm'>
                <button
                  onClick={() => setPaymentScheme('4mica-credit')}
                  className={`rounded-lg px-3 py-2 border ${
                    paymentScheme === '4mica-credit'
                      ? 'border-emerald-400 bg-emerald-500/20 text-white'
                      : 'border-white/10 text-gray-300'
                  }`}
                >
                  4mica credit
                </button>
                <button
                  onClick={() => setPaymentScheme('x402')}
                  className={`rounded-lg px-3 py-2 border ${
                    paymentScheme === 'x402'
                      ? 'border-indigo-400 bg-indigo-500/20 text-white'
                      : 'border-white/10 text-gray-300'
                  }`}
                >
                  x402
                </button>
              </div>
              {paymentScheme === '4mica-credit' && (
                <div className='text-xs text-gray-400'>
                  Lower gas footprint; uses your 4mica credit balance to keep playback uninterrupted.
                </div>
              )}
            </div>

            {paymentScheme === '4mica-credit' ? (
              <div className='space-y-3'>
                <div className='text-gray-200 font-semibold flex items-center justify-between'>
                  <span>Deposit to 4mica</span>
                  <span className='text-xs text-gray-400'>Default: USDC</span>
                </div>
                <div className='grid grid-cols-2 gap-2 text-sm'>
                  <button
                    onClick={() => setDepositMode('default')}
                    className={`rounded-lg px-3 py-2 border ${
                      depositMode === 'default'
                        ? 'border-emerald-400 bg-emerald-500/20 text-white'
                        : 'border-white/10 text-gray-300'
                    }`}
                  >
                    USDC (default)
                  </button>
                  <button
                    onClick={() => setDepositMode('custom')}
                    className={`rounded-lg px-3 py-2 border ${
                      depositMode === 'custom'
                        ? 'border-indigo-400 bg-indigo-500/20 text-white'
                        : 'border-white/10 text-gray-300'
                    }`}
                  >
                    Custom token
                  </button>
                </div>

                {depositMode === 'default' ? (
                  <div className='text-xs text-gray-300'>
                    Using USDC (6 decimals)
                    {defaultTokenAddress && <div className='mt-1 break-all text-gray-400'>Address: {defaultTokenAddress}</div>}
                  </div>
                ) : (
                  <>
                    <div className='text-xs text-gray-400'>Token address</div>
                    <input
                      value={tokenAddress}
                      onChange={e => setTokenAddress(e.target.value)}
                      placeholder='Token address (0x...)'
                      className='w-full rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-sm text-gray-100 placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-400'
                    />
                    <div className='text-xs text-gray-400'>Token decimals (e.g., 6 or 18)</div>
                    <input
                      type='number'
                      min='0'
                      max='36'
                      value={tokenDecimals}
                      onChange={e => setTokenDecimals(e.target.value)}
                      placeholder='Token decimals'
                      className='w-full rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-sm text-gray-100 placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-400'
                    />
                  </>
                )}

                <div className='text-xs text-gray-400'>Deposit amount</div>
                <input
                  type='number'
                  min='0'
                  step='0.01'
                  value={depositAmount}
                  onChange={e => setDepositAmount(e.target.value)}
                  placeholder='Amount to deposit'
                  className='w-full rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-sm text-gray-100 placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-400'
                />
                <button
                  onClick={handleDeposit}
                  disabled={depositLoading || onWrongChain || paramsLoading}
                  className='w-full rounded-lg bg-indigo-500 text-white py-2.5 font-semibold hover:bg-indigo-400 transition disabled:opacity-60'
                >
                  {depositLoading ? 'Depositing...' : 'Deposit'}
                </button>
                {paramsLoading && <div className='text-xs text-gray-400'>Loading 4mica contract params…</div>}
                <div className='text-xs text-gray-400'>
                  Deposits call the 4mica core contract on Polygon Amoy using your connected wallet.
                </div>
                {onWrongChain && (
                  <button
                    onClick={switchToTargetChain}
                    className='w-full rounded-lg bg-yellow-400 text-gray-900 py-2 font-semibold hover:bg-yellow-300 transition'
                  >
                    Switch to Polygon Amoy
                  </button>
                )}
              </div>
            ) : (
              <div className='rounded-xl bg-white/5 border border-white/10 p-4 space-y-2'>
                <div className='text-gray-200 font-semibold'>x402 mode</div>
                {onWrongChain ? (
                  <button
                    onClick={switchToTargetChain}
                    className='w-full rounded-lg bg-yellow-400 text-gray-900 py-2 font-semibold hover:bg-yellow-300 transition'
                  >
                    Switch to Polygon Amoy
                  </button>
                ) : (
                  <div className='text-xs text-emerald-200 bg-emerald-500/10 border border-emerald-500/30 rounded-lg px-3 py-2'>Polygon Amoy ready.</div>
                )}
              </div>
            )}
          </div>

          <button
            onClick={disconnect}
            className='mt-auto px-4 py-2 rounded bg-red-600 text-white hover:bg-red-500 transition'
          >
            Disconnect
          </button>
        </div>

        <div>
          {onWrongChain ? (
            <div className='bg-yellow-500/10 border border-yellow-500/40 rounded-xl p-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4'>
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
            <div className='bg-black rounded-lg overflow-hidden shadow-2xl'>
              <VideoPlayer
                src={config.playlistUrl}
                onReady={handlePlayerReady}
                paymentHandler={paymentHandler}
                paymentEvents={paymentEvents}
              />
            </div>
          )}

          {playerReady && !onWrongChain && <div className='mt-4 text-center text-gray-400 text-sm'>Player ready</div>}
        </div>

        <div className='relative overflow-hidden bg-gradient-to-br from-slate-900/90 via-slate-950 to-black border border-white/10 rounded-2xl p-5 shadow-[0_15px_45px_rgba(0,0,0,0.5)] flex flex-col gap-4 max-h-[640px]'>
          <div className='absolute inset-0 pointer-events-none opacity-40 bg-[radial-gradient(circle_at_20%_20%,rgba(59,130,246,0.2),transparent_35%),radial-gradient(circle_at_80%_10%,rgba(16,185,129,0.2),transparent_25%)]' />
          <div className='flex items-center justify-between relative z-10'>
            <div className='text-gray-50 font-semibold text-lg tracking-tight'>Activity log</div>
            <div className='text-xs text-gray-400'>{logs.length} entries</div>
          </div>
          <div className='rounded-xl bg-black/40 border border-white/5 p-3 text-sm text-gray-200 space-y-2 overflow-y-auto relative z-10'>
            {logs.length === 0 ? (
              <div className='text-gray-500 text-center py-8'>No activity yet. Deposits, balance fetches, and errors will show here.</div>
            ) : (
              logs.map((log, idx) => {
                const toneMeta: Record<LogTone, { className: string; label: string; badge: string }> = {
                  info: { className: 'bg-white/5 border-white/10 text-gray-100', label: 'Info', badge: '•' },
                  warn: { className: 'bg-amber-500/15 border-amber-400/30 text-amber-100', label: 'Payment requested', badge: '!' },
                  success: { className: 'bg-emerald-500/15 border-emerald-400/30 text-emerald-100', label: 'Settled', badge: '✓' },
                  error: { className: 'bg-red-500/15 border-red-400/30 text-red-100', label: 'Error', badge: '×' },
                }
                const meta = toneMeta[log.tone]
                return (
                  <div key={idx} className={`rounded-lg px-3 py-2 border shadow-sm backdrop-blur-sm space-y-1.5 ${meta.className}`}>
                    <div className='flex items-center gap-2 text-[11px] uppercase tracking-[0.1em]'>
                      <span className='inline-flex items-center justify-center h-5 w-5 rounded-full border border-current text-[11px]'>
                        {meta.badge}
                      </span>
                      <span className='font-semibold'>{meta.label}</span>
                    </div>
                    <div className='text-sm leading-relaxed text-white/90 break-words flex flex-wrap items-center gap-2'>
                      <span>{log.text}</span>
                    </div>
                    {log.txHash && (
                      <div className='flex flex-wrap items-center gap-2 text-xs text-indigo-100'>
                        <span className='px-2 py-1 rounded bg-indigo-500/15 border border-indigo-400/30 text-[11px] uppercase tracking-[0.12em]'>
                          Tx hash
                        </span>
                        <span className='font-mono break-all'>{log.txHash}</span>
                        {explorerUrlForTx(log.txHash) && (
                          <a
                            href={explorerUrlForTx(log.txHash) ?? undefined}
                            target='_blank'
                            rel='noopener noreferrer'
                            className='inline-flex items-center gap-1 text-indigo-200 hover:text-indigo-50 underline decoration-dotted decoration-1'
                          >
                            <span className='text-[11px] uppercase tracking-[0.14em]'>View on explorer</span>
                            <span className='font-mono text-[11px]'>{formatTxHash(log.txHash)}</span>
                          </a>
                        )}
                      </div>
                    )}
                    <div className='text-xs opacity-80 text-right'>{log.at}</div>
                  </div>
                )
              })
            )}
          </div>
        </div>
      </div>
    )
  }

  const isBootstrapping = !hasTriedEager

  if (isBootstrapping) {
    return (
      <div className='relative min-h-screen bg-gradient-to-br from-slate-950 via-indigo-950 to-slate-900 flex items-center justify-center p-4 overflow-hidden'>
        <div className='absolute -top-40 -right-24 h-80 w-80 bg-indigo-500/30 blur-3xl rounded-full pointer-events-none' />
        <div className='absolute -bottom-32 -left-10 h-80 w-80 bg-emerald-500/20 blur-3xl rounded-full pointer-events-none' />
        <div className='w-full max-w-3xl mx-auto text-center space-y-4'>
          <div className='inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white/10 border border-white/15 text-xs uppercase tracking-[0.12em] text-indigo-100'>
            <span className='h-2.5 w-2.5 rounded-full bg-emerald-400 animate-pulse' />
            Restoring wallet session
          </div>
          <div className='text-2xl md:text-3xl text-white font-semibold'>Checking for an existing connection…</div>
          <div className='text-gray-400 text-sm'>If you previously approved this site, your wallet will reconnect automatically.</div>
        </div>
      </div>
    )
  }

  return (
    <div className='relative min-h-screen bg-gradient-to-br from-slate-950 via-indigo-950 to-slate-900 flex items-center justify-center p-4 overflow-hidden'>
      <div className='absolute -top-40 -right-24 h-80 w-80 bg-indigo-500/30 blur-3xl rounded-full pointer-events-none' />
      <div className='absolute -bottom-32 -left-10 h-80 w-80 bg-emerald-500/20 blur-3xl rounded-full pointer-events-none' />
      <div className='w-full max-w-6xl'>
        <div className='mb-4'>
          <h1 className='text-2xl font-light text-gray-100 tracking-wide'>Polygon streaming access</h1>
          <p className='text-gray-400 text-sm mt-1'>Use your wallet to enter the live demo; signatures stay automatic while you watch.</p>
        </div>

        {isConnected ? renderPlayerScreen() : renderConnectScreen()}
      </div>
    </div>
  )
}

export default App
