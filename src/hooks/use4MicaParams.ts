import { useEffect, useState } from 'react'
import * as fourMica from 'sdk-4mica'
import { config } from '../config/env'

const boundFetch = (input: RequestInfo | URL, init?: RequestInit) => {
  const f = globalThis.fetch as any
  if (typeof f !== 'function') throw new Error('global fetch not available')
  return f.call(globalThis, input, init)
}

export const use4MicaParams = (
  isConnected: boolean,
  appendLog: (entry: string, tone?: 'info' | 'warn' | 'success' | 'error') => void
) => {
  const [coreParams, setCoreParams] = useState<fourMica.CorePublicParameters | null>(null)
  const [paramsLoading, setParamsLoading] = useState(false)

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
        appendLog(`Failed to load 4mica params: ${err instanceof Error ? err.message : String(err)}`, 'error')
      } finally {
        if (active) setParamsLoading(false)
      }
    }
    loadParams()
    return () => {
      active = false
    }
  }, [isConnected])

  return { coreParams, paramsLoading }
}
