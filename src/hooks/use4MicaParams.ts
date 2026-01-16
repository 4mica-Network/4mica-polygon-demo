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
        const url = `${config.signerServiceUrl.replace(/\/+$/, '')}/params`
        const resp = await boundFetch(url, { method: 'GET' })
        const text = await resp.text()
        if (!resp.ok) {
          throw new Error(text || `params request failed with ${resp.status}`)
        }
        const parsed = text ? JSON.parse(text) : {}
        const payload = (parsed?.params ?? parsed) as Record<string, unknown>
        const p = fourMica.CorePublicParameters.fromRpc(payload)
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
