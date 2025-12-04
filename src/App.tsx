import { useCallback, useEffect, useMemo, useState } from 'react'
import type Player from 'video.js/dist/types/player'
import { Contract, formatEther, formatUnits, isAddress, parseUnits } from 'ethers'
import VideoPlayer from './components/VideoPlayer'
import { config } from './config/env'
import { TARGET_CHAIN_ID, useWallet } from './context/WalletContext'
import { createPaymentHandler } from './utils/paymentHandler'
import core4micaAbi from 'sdk-4mica/dist/abi/core4mica.json'
import * as fourMica from 'sdk-4mica'

const boundFetch = (input: RequestInfo | URL, init?: RequestInit) => {
  const f = globalThis.fetch as any
  if (typeof f !== 'function') throw new Error('global fetch not available')
  return f.call(globalThis, input, init)
}

function App() {
  const [playerReady, setPlayerReady] = useState<boolean>(false)
  const { address, chainId, isConnecting, error, isConnected, connect, disconnect, signer, switchToTargetChain } = useWallet()
  const [balance, setBalance] = useState<string | null>(null)
  const [balanceLoading, setBalanceLoading] = useState(false)
  const [depositAmount, setDepositAmount] = useState('10')
  const [depositMode, setDepositMode] = useState<'default' | 'custom'>('default')
  const [tokenAddress, setTokenAddress] = useState('')
  const [tokenDecimals, setTokenDecimals] = useState('18')
  const [depositLoading, setDepositLoading] = useState(false)
  const [logs, setLogs] = useState<string[]>([])
  const [coreParams, setCoreParams] = useState<fourMica.CorePublicParameters | null>(null)
  const [paramsLoading, setParamsLoading] = useState(false)
  const [tokenBalances, setTokenBalances] = useState<
    { address: string; symbol: string; balance: string; decimals: number }[]
  >([])

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

  const appendLog = useCallback((entry: string) => {
    setLogs(prev => {
      const next = [`${new Date().toLocaleTimeString()} — ${entry}`, ...prev]
      return next.slice(0, 100)
    })
  }, [])

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
    } catch (err) {
      appendLog(`Deposit failed: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setDepositLoading(false)
    }
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
    const defaultTokenAddress = config.defaultTokenAddress
    return (
      <div className='grid gap-6 lg:grid-cols-[320px_minmax(0,1fr)_320px]'>
        <div className='bg-gray-800/90 border border-white/10 rounded-2xl p-5 shadow-xl flex flex-col gap-4'>
          <div>
            <div className='text-gray-100 font-semibold text-lg flex items-center gap-2'>
              <span>Wallet overview</span>
            </div>
            <div className='text-gray-400 text-sm mt-1 break-all'>{address}</div>
          </div>
          <div className='rounded-xl bg-white/5 border border-white/10 p-4 space-y-2'>
            <div className='text-sm text-gray-300 flex items-center justify-between'>
              <span>Network</span>
              <span className='px-2 py-1 rounded-full bg-indigo-500/20 text-indigo-100 text-xs'>Polygon Amoy</span>
            </div>
            <div className='text-sm text-gray-300 flex items-center justify-between'>
              <span>Chain ID</span>
              <span className={onWrongChain ? 'text-yellow-300' : 'text-emerald-300'}>{chainId ?? 'Unknown'}</span>
            </div>
            <div className='text-sm text-gray-300 flex items-center justify-between'>
              <span>Balance</span>
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
              <VideoPlayer src={config.playlistUrl} onReady={handlePlayerReady} paymentHandler={paymentHandler} />
            </div>
          )}

          {playerReady && !onWrongChain && <div className='mt-4 text-center text-gray-400 text-sm'>Player ready</div>}
        </div>

        <div className='bg-slate-900/90 border border-white/10 rounded-2xl p-5 shadow-xl flex flex-col gap-4 max-h-[640px]'>
          <div className='flex items-center justify-between'>
            <div className='text-gray-100 font-semibold text-lg'>Activity log</div>
            <div className='text-xs text-gray-400'>{logs.length} entries</div>
          </div>
          <div className='rounded-xl bg-black/40 border border-white/5 p-3 text-sm text-gray-200 space-y-2 overflow-y-auto'>
            {logs.length === 0 ? (
              <div className='text-gray-500 text-center py-8'>No activity yet. Deposits, balance fetches, and errors will show here.</div>
            ) : (
              logs.map((log, idx) => (
                <div key={idx} className='bg-white/5 rounded px-3 py-2 border border-white/5'>
                  {log}
                </div>
              ))
            )}
          </div>
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
          <h1 className='text-2xl font-light text-gray-100 tracking-wide'>4Mica x Polygon Demo</h1>
          <p className='text-gray-400 text-sm mt-1'>Connect a wallet to sign x402 payments on Polygon-Amoy.</p>
        </div>

        {isConnected ? renderPlayerScreen() : renderConnectScreen()}
      </div>
    </div>
  )
}

export default App
