import { useCallback, useState } from 'react'

type LogTone = 'info' | 'warn' | 'success' | 'error'

interface LogEntry {
  text: string
  tone: LogTone
  at: string
  txHash?: string
}

export const useActivityLog = () => {
  const [logs, setLogs] = useState<LogEntry[]>([])

  const appendLog = useCallback((entry: string, tone: LogTone = 'info', txHash?: string) => {
    setLogs(prev => {
      const next = [{ text: entry, tone, at: new Date().toLocaleTimeString(), txHash }, ...prev]
      return next.slice(0, 100)
    })
  }, [])

  return { logs, appendLog }
}

