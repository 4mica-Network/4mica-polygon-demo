import { useEffect, useState } from 'react'
import * as fourMica from '@4mica/sdk'
import { useWallet } from '../context/WalletContext'
import { use4MicaParams } from './use4MicaParams'

export const useClient = (
    appendLog?: (entry: string, tone?: 'info' | 'warn' | 'success' | 'error') => void
) => {
    const { isConnected } = useWallet()
    const { coreParams } = use4MicaParams(isConnected, appendLog || (() => { }))
    const [client, setClient] = useState<fourMica.Client | null>(null)
    const [clientLoading, setClientLoading] = useState(false)
    const [clientError, setClientError] = useState<string | null>(null)

    useEffect(() => {
        setClient(null)
        setClientLoading(false)
        setClientError(
            'Client-side signer disabled. Use the backend signer service for payments; deposits are out of scope in this demo.'
        )
        return () => {
            client?.aclose?.().catch(console.error)
        }
    }, [coreParams?.contractAddress, coreParams?.ethereumHttpRpcUrl])

    return { client, clientLoading, clientError }
}
