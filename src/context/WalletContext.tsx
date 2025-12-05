import { BrowserProvider, JsonRpcSigner } from 'ethers'
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'

declare global {
  interface Window {
    ethereum?: any
  }
}

type WalletContextValue = {
  address: string | null
  chainId: number | null
  signer: JsonRpcSigner | null
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
const TARGET_CHAIN_HEX = '0x13882'
const TARGET_CHAIN = {
  chainId: TARGET_CHAIN_HEX,
  chainName: 'Polygon Amoy',
  nativeCurrency: { name: 'MATIC', symbol: 'MATIC', decimals: 18 },
  rpcUrls: ['https://rpc-amoy.polygon.technology'],
  blockExplorerUrls: ['https://amoy.polygonscan.com'],
}

const initialState = {
  address: null,
  chainId: null,
  signer: null,
  isConnecting: false,
  hasTriedEager: false,
  error: null as string | null,
}

export const WalletProvider: React.FC<React.PropsWithChildren> = ({ children }) => {
  const [state, setState] = useState(initialState)

  const reset = useCallback(() => setState({ ...initialState, hasTriedEager: true }), [])

  const setConnectedState = useCallback(
    async (provider: BrowserProvider, signer?: JsonRpcSigner, customError?: string | null) => {
      const signerToUse = signer ?? (await provider.getSigner())
      const address = await signerToUse.getAddress()
      const network = await provider.getNetwork()
      setState({
        address,
        chainId: Number(network.chainId),
        signer: signerToUse,
        isConnecting: false,
        hasTriedEager: true,
        error: customError ?? null,
      })
      return { address, chainId: Number(network.chainId) }
    },
    []
  )

  const connect = useCallback(async () => {
    setState(prev => ({ ...prev, isConnecting: true, error: null }))
    try {
      const eth = window.ethereum
      if (!eth) {
        throw new Error('No wallet found. Install MetaMask or use a WalletConnect-enabled wallet.')
      }

      const provider = new BrowserProvider(eth)
      const accounts: string[] = await provider.send('eth_requestAccounts', [])
      if (!accounts || accounts.length === 0) {
        throw new Error('No accounts authorized in the wallet.')
      }

      const signer = await provider.getSigner()
      const address = await signer.getAddress()
      const network = await provider.getNetwork()

      // Try to switch if not on the target chain
      if (Number(network.chainId) !== TARGET_CHAIN_ID) {
        try {
          await eth.request({
            method: 'wallet_switchEthereumChain',
            params: [{ chainId: TARGET_CHAIN_HEX }],
          })
          await setConnectedState(provider, signer)
          return
        } catch (switchErr: any) {
          console.warn('Chain switch declined or failed', switchErr)
          await setConnectedState(provider, signer, 'Please switch to Polygon Amoy (80002) to continue.')
          return
        }
      }

      await setConnectedState(provider, signer)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to connect wallet'
      setState(prev => ({ ...prev, isConnecting: false, hasTriedEager: true, error: message }))
      throw err
    }
  }, [setConnectedState])

  const switchToTargetChain = useCallback(async (): Promise<boolean> => {
    const eth = window.ethereum
    if (!eth) {
      setState(prev => ({ ...prev, error: 'No wallet found. Install MetaMask or a compatible wallet.' }))
      return false
    }
    try {
      await eth.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: TARGET_CHAIN_HEX }],
      })
      const provider = new BrowserProvider(eth)
      const network = await provider.getNetwork()
      setState(prev => ({ ...prev, chainId: Number(network.chainId), hasTriedEager: true, error: null }))
      return true
    } catch (err: any) {
      // Attempt to add the chain if it's missing
      if (err?.code === 4902 || err?.message?.includes('Unrecognized chain ID')) {
        try {
          await eth.request({
            method: 'wallet_addEthereumChain',
            params: [TARGET_CHAIN],
          })
          const provider = new BrowserProvider(eth)
          const network = await provider.getNetwork()
          setState(prev => ({ ...prev, chainId: Number(network.chainId), hasTriedEager: true, error: null }))
          return true
        } catch (addErr) {
          const message = addErr instanceof Error ? addErr.message : 'Failed to add Polygon Amoy'
          setState(prev => ({ ...prev, hasTriedEager: true, error: message }))
          return false
        }
      }
      const message = err instanceof Error ? err.message : 'Failed to switch chain'
      setState(prev => ({ ...prev, hasTriedEager: true, error: message }))
      return false
    }
  }, [])

  useEffect(() => {
    const eth = window.ethereum
    if (!eth) return

    let cancelled = false
    const attemptEagerConnect = async () => {
      setState(prev => ({ ...prev, isConnecting: true }))
      try {
        const provider = new BrowserProvider(eth)
        const accounts: string[] = await provider.send('eth_accounts', [])
        if (!accounts || accounts.length === 0) {
          if (!cancelled) {
            setState(prev => ({ ...prev, isConnecting: false, hasTriedEager: true }))
          }
          return
        }
        const signer = await provider.getSigner()
        const address = await signer.getAddress()
        const network = await provider.getNetwork()
        if (cancelled) return
        const chainId = Number(network.chainId)
        const maybeError = chainId === TARGET_CHAIN_ID ? null : 'Switch to Polygon Amoy (80002) to continue.'
        setState({
          address,
          chainId,
          signer,
          isConnecting: false,
          hasTriedEager: true,
          error: maybeError,
        })
      } catch (err) {
        if (!cancelled) {
          setState(prev => ({ ...prev, isConnecting: false, hasTriedEager: true }))
        }
      }
    }
    attemptEagerConnect()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const eth = window.ethereum
    if (!eth) return

    const handleAccountsChanged = (accounts: string[]) => {
      if (!accounts || accounts.length === 0) {
        reset()
        return
      }
      setState(prev => ({
        ...prev,
        address: accounts[0],
      }))
    }

    const handleChainChanged = (chainIdHex: string) => {
      const chainId = Number.parseInt(chainIdHex, 16)
      setState(prev => ({
        ...prev,
        chainId,
      }))
    }

    eth.on?.('accountsChanged', handleAccountsChanged)
    eth.on?.('chainChanged', handleChainChanged)
    return () => {
      eth.removeListener?.('accountsChanged', handleAccountsChanged)
      eth.removeListener?.('chainChanged', handleChainChanged)
    }
  }, [reset])

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
