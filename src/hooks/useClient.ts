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
            // We need coreParams to know the contract address if not in config
            // But SDK ConfigBuilder allows optional contract address if it's in env
            // However, for the demo app, we usually get it from the public params endpoint

            if (!config.walletPrivateKey) {
                setClientError('Missing VITE_WALLET_PRIVATE_KEY in environment')
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

                // Bind fetch globally for the SDK if needed, though SDK usually uses passed fetch or global
                // The SDK Client implementation in the provided files doesn't seem to take a fetch fn in constructor directly?
                // Wait, Client.new(cfg) is static. Let's check Client.ts again.
                // Client.new calls new Client(cfg, rpc, gateway).
                // It seems Client.new might use default fetch.
                // To be safe, we can try to hijack global fetch or hope it picks it up.
                // The SDK file I read earlier: RpcProxy takes fetchFn. Client.new creates RpcProxy.
                // Client.new implementation:
                // static async new(cfg: Config): Promise<Client> { ... const rpc = new RpcProxy(cfg.rpcUrl, cfg.adminApiKey); ... }
                // It uses default fetch.

                // Temporarily bind custom fetch if needed for context (e.g. auth headers not relevant here)
                // But for browser, window.fetch is fine.

                // Patch global fetch to ensure it's bound to window/globalThis when SDK captures it
                const originalFetch = globalThis.fetch
                globalThis.fetch = originalFetch.bind(globalThis)

                let newClient
                try {
                    newClient = await fourMica.Client.new(cfg)
                } finally {
                    // Restore original fetch (RpcProxy has already captured the bound version)
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
            // client.aclose() is async, can't easily await in cleanup
            // but strictly we should try to close if we are replacing it
            client?.aclose?.().catch(console.error)
        }
    }, [config.walletPrivateKey, config.rpcUrl, config.rpcProxyUrl, coreParams, appendLog])

    return { client, clientLoading, clientError }
}
