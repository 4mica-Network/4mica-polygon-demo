import { JsonRpcProvider, Signer, Wallet } from 'ethers'
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { config } from '../config/env'

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

  const buildEnvSigner = useCallback(async () => {
    const privateKey = config.walletPrivateKey?.trim()
    if (!privateKey) {
      throw new Error('Missing VITE_WALLET_PRIVATE_KEY for automated access.')
    }

    if (!config.rpcProxyUrl) {
      throw new Error('Missing RPC URL (VITE_ETH_RPC_PROXY_URL) for wallet provider.')
    }

    const provider = new JsonRpcProvider(config.rpcProxyUrl)
    const signer = new Wallet(privateKey, provider)
    const [address, network] = await Promise.all([signer.getAddress(), provider.getNetwork()])
    return { signer, address, chainId: Number(network.chainId) }
  }, [])

  const connect = useCallback(async () => {
    setState(prev => ({ ...prev, isConnecting: true, error: null }))
    try {
      const { signer, address, chainId } = await buildEnvSigner()
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
  }, [buildEnvSigner])

  const switchToTargetChain = useCallback(async (): Promise<boolean> => {
    try {
      const { signer, address, chainId } = await buildEnvSigner()
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
  }, [buildEnvSigner])

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
