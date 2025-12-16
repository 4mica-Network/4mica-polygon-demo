import { JsonRpcProvider, Signer } from 'ethers'
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { config } from '../config/env'
import { RemoteSigner } from '../utils/RemoteSigner'

type WalletContextValue = {
  address: string | null
  chainId: number | null
  signer: Signer | null
  isConnecting: boolean
  hasTriedEager: boolean
  error: string | null
  isConnected: boolean
  connect: () => Promise<void>
  disconnect: () => void
  switchToTargetChain: () => Promise<boolean>
}

const WalletContext = createContext<WalletContextValue | undefined>(undefined)

const TARGET_CHAIN_ID = 80002
const CONNECT_TIMEOUT_MS = 10_000

const withTimeout = <T,>(promise: Promise<T>, timeoutMs: number, timeoutMessage: string): Promise<T> =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs)
    promise
      .then(value => {
        clearTimeout(timer)
        resolve(value)
      })
      .catch(error => {
        clearTimeout(timer)
        reject(error)
      })
  })

const initialState: {
  address: string | null
  chainId: number | null
  signer: Signer | null
  isConnecting: boolean
  hasTriedEager: boolean
  error: string | null
} = {
  address: null,
  chainId: null,
  signer: null,
  isConnecting: false,
  hasTriedEager: false,
  error: null,
}

export const WalletProvider: React.FC<React.PropsWithChildren> = ({ children }) => {
  const [state, setState] = useState(initialState)

  const reset = useCallback(() => setState({ ...initialState, hasTriedEager: true }), [])

  const buildRemoteSigner = useCallback(async () => {
    if (!config.signerServiceUrl) {
      throw new Error('Missing signer service URL (VITE_SIGNER_SERVICE_URL).')
    }

    if (!config.rpcProxyUrl) {
      throw new Error('Missing RPC URL (VITE_ETH_RPC_PROXY_URL) for wallet provider.')
    }

    const infoUrl = `${config.signerServiceUrl.replace(/\/+$/, '')}/info`
    const resp = await fetch(infoUrl)
    if (!resp.ok) {
      const msg = await resp.text()
      throw new Error(msg || 'Failed to reach signer service.')
    }
    const info = (await resp.json()) as { address?: string; chainId?: number }
    const address = info.address?.trim()
    if (!address) {
      throw new Error('Signer service did not return an address.')
    }

    const provider = new JsonRpcProvider(config.rpcProxyUrl)
    const signer = new RemoteSigner(address, config.signerServiceUrl, provider)
    const network = await provider.getNetwork()
    const chainId = Number(info.chainId ?? network.chainId)
    return { signer, address, chainId }
  }, [])

  const connect = useCallback(async () => {
    setState(prev => ({ ...prev, isConnecting: true, hasTriedEager: true, error: null }))
    try {
      const { signer, address, chainId } = await withTimeout(
        buildRemoteSigner(),
        CONNECT_TIMEOUT_MS,
        'Wallet initialization timed out. Check RPC connectivity.'
      )
      setState({
        address,
        chainId,
        signer,
        isConnecting: false,
        hasTriedEager: true,
        error: null,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load wallet'
      setState(prev => ({ ...prev, isConnecting: false, hasTriedEager: true, error: message }))
    }
  }, [buildRemoteSigner])

  const switchToTargetChain = useCallback(async (): Promise<boolean> => {
    try {
      const { signer, address, chainId } = await withTimeout(
        buildRemoteSigner(),
        CONNECT_TIMEOUT_MS,
        'Refreshing RPC connection timed out. Check RPC connectivity.'
      )
      if (chainId !== TARGET_CHAIN_ID) {
        setState(prev => ({
          ...prev,
          hasTriedEager: true,
          chainId,
          error: `RPC connected to chain ${chainId}; expected ${TARGET_CHAIN_ID}.`,
        }))
        return false
      }
      setState({
        address,
        chainId,
        signer,
        isConnecting: false,
        hasTriedEager: true,
        error: null,
      })
      return true
    } catch (err: any) {
      const message = err instanceof Error ? err.message : 'Failed to refresh RPC connection'
      setState(prev => ({ ...prev, hasTriedEager: true, error: message }))
      return false
    }
  }, [buildRemoteSigner])

  useEffect(() => {
    connect()
  }, [connect])

  const value = useMemo<WalletContextValue>(
    () => ({
      ...state,
      isConnected: Boolean(state.address && state.signer),
      connect,
      disconnect: reset,
      switchToTargetChain,
    }),
    [state, connect, reset, switchToTargetChain]
  )

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>
}

export const useWallet = (): WalletContextValue => {
  const ctx = useContext(WalletContext)
  if (!ctx) {
    throw new Error('useWallet must be used within a WalletProvider')
  }
  return ctx
}

export { TARGET_CHAIN_ID }
