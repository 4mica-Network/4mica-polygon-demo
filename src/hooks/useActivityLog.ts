import { useCallback, useState } from 'react'

type LogTone = 'info' | 'warn' | 'success' | 'error'

interface LogEntry {
  text: string
  tone: LogTone
  at: string
  txHash?: string
}

const normalizeTxHash = (hash?: string) => {
  if (!hash) return undefined
  const trimmed = hash.trim()
  if (!trimmed) return undefined

  if ((trimmed.startsWith('0x') || trimmed.startsWith('0X')) && /^[0-9a-fA-F]+$/.test(trimmed.slice(2))) {
    return `0x${trimmed.slice(2).toLowerCase()}`
  }

  if (/^[0-9]+$/.test(trimmed)) {
    try {
      return `0x${BigInt(trimmed).toString(16)}`
    } catch {
      return trimmed
    }
  }

  if (/^[0-9a-fA-F]+$/.test(trimmed)) {
    return `0x${trimmed.toLowerCase()}`
  }

  return trimmed
}

export const useActivityLog = () => {
  const [logs, setLogs] = useState<LogEntry[]>([])

  const appendLog = useCallback((entry: string, tone: LogTone = 'info', txHash?: string) => {
    setLogs(prev => {
      const next = [
        { text: entry, tone, at: new Date().toLocaleTimeString(), txHash: normalizeTxHash(txHash) },
        ...prev,
      ]
      return next.slice(0, 100)
    })
  }, [])

  return { logs, appendLog }
}
