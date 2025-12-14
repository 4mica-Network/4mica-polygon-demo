import { useEffect, useState } from 'react'
import * as fourMica from 'sdk-4mica'
import { config } from '../config/env'
import { useWallet } from '../context/WalletContext'
import { use4MicaParams } from './use4MicaParams'

const boundFetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const f = globalThis.fetch as any
    if (typeof f !== 'function') throw new Error('global fetch not available')
    return f.call(globalThis, input, init)
}

export const useClient = (
    appendLog?: (entry: string, tone?: 'info' | 'warn' | 'success' | 'error') => void
) => {
    const { isConnected } = useWallet()
    const { coreParams } = use4MicaParams(isConnected, appendLog || (() => { }))
    const [client, setClient] = useState<fourMica.Client | null>(null)
    const [clientLoading, setClientLoading] = useState(false)
    const [clientError, setClientError] = useState<string | null>(null)

    useEffect(() => {
        let active = true
        const init = async () => {
            if (!config.walletPrivateKey) {
                setClientError('Missing VITE_WALLET_PRIVATE_KEY in environment')
                return
            }

            if (!coreParams) {
                return
            }

            setClientLoading(true)
            setClientError(null)

            try {
                const builder = new fourMica.ConfigBuilder()
                    .walletPrivateKey(config.walletPrivateKey)
                    .rpcUrl(config.rpcUrl)

                const proxyRpc = config.rpcProxyUrl || coreParams?.ethereumHttpRpcUrl
                if (proxyRpc) {
                    builder.ethereumHttpRpcUrl(proxyRpc)
                }

                if (coreParams?.contractAddress) {
                    builder.contractAddress(coreParams.contractAddress)
                }

                const cfg = builder.build()

                const originalFetch = globalThis.fetch
                globalThis.fetch = originalFetch.bind(globalThis)

                let newClient
                try {
                    newClient = await fourMica.Client.new(cfg)
                } finally {
                    globalThis.fetch = originalFetch
                }
                if (active) {
                    setClient(newClient)
                }
            } catch (err) {
                if (active) {
                    const msg = err instanceof Error ? err.message : String(err)
                    setClientError(msg)
                    appendLog?.(`SDK Client init failed: ${msg}`, 'error')
                }
            } finally {
                if (active) setClientLoading(false)
            }
        }

        init()

        return () => {
            active = false
            client?.aclose?.().catch(console.error)
        }
    }, [coreParams?.contractAddress, coreParams?.ethereumHttpRpcUrl])

    return { client, clientLoading, clientError }
}
