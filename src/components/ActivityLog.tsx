type LogTone = 'info' | 'warn' | 'success' | 'error'

interface LogEntry {
  text: string
  tone: LogTone
  at: string
  txHash?: string
}

interface ActivityLogProps {
  logs: LogEntry[]
}

const formatTxHash = (hash?: string) => {
  if (!hash) return ''
  if (hash.length <= 18) return hash
  return `${hash.slice(0, 10)}...${hash.slice(-6)}`
}

const explorerUrlForTx = (hash?: string) => (hash ? `https://amoy.polygonscan.com/tx/${hash}` : null)

const toneMeta: Record<LogTone, { bg: string; border: string; text: string; label: string; badge: string }> = {
  info: { bg: 'bg-gray-800', border: 'border-gray-600', text: 'text-gray-100', label: 'Info', badge: '•' },
  warn: {
    bg: 'bg-amber-900',
    border: 'border-amber-600',
    text: 'text-amber-100',
    label: 'Payment requested',
    badge: '!',
  },
  success: {
    bg: 'bg-emerald-900',
    border: 'border-emerald-600',
    text: 'text-emerald-100',
    label: 'Settled',
    badge: '✓',
  },
  error: { bg: 'bg-red-900', border: 'border-red-600', text: 'text-red-100', label: 'Error', badge: '×' },
}

const LogEntryItem = ({ log }: { log: LogEntry }) => {
  const meta = toneMeta[log.tone]
  const explorerUrl = explorerUrlForTx(log.txHash)

  return (
    <div className={`rounded-lg px-4 py-3 border ${meta.bg} ${meta.border} ${meta.text} min-w-[280px]`}>
      <div className='flex items-center gap-2 text-xs uppercase tracking-wide mb-2'>
        <span className='inline-flex items-center justify-center w-5 h-5 rounded-full border border-current text-xs'>
          {meta.badge}
        </span>
        <span className='font-semibold'>{meta.label}</span>
        <span className='ml-auto opacity-70'>{log.at}</span>
      </div>

      <div className='text-sm leading-relaxed text-white break-words'>{log.text}</div>

      {log.txHash && (
        <div className='flex flex-wrap items-center gap-2 text-xs text-indigo-200 mt-2'>
          <span className='px-2 py-1 rounded bg-indigo-900 border border-indigo-700 text-xs uppercase tracking-wide'>
            Tx
          </span>
          {explorerUrl && (
            <a
              href={explorerUrl}
              target='_blank'
              rel='noopener noreferrer'
              className='text-indigo-300 hover:text-indigo-100 underline decoration-dotted cursor-pointer'
            >
              {formatTxHash(log.txHash)}
            </a>
          )}
        </div>
      )}
    </div>
  )
}

const ActivityLog = ({ logs }: ActivityLogProps) => {
  return (
    <div className='relative overflow-hidden bg-gradient-to-br from-slate-900 via-slate-950 to-black border border-gray-700 rounded-2xl p-5 shadow-2xl'>
      <div className='flex items-center justify-between mb-4'>
        <div className='text-white font-semibold text-lg tracking-tight'>Activity log</div>
        <div className='text-xs text-gray-400'>{logs.length} entries</div>
      </div>

      <div className='rounded-xl bg-black border border-gray-800 p-4 overflow-x-auto'>
        {logs.length === 0 ? (
          <div className='text-gray-500 text-center py-8 text-sm'>
            No activity yet. Deposits, balance fetches, and errors will show here.
          </div>
        ) : (
          <div className='flex flex-col gap-3 pb-2'>
            {logs.map((log, idx) => (
              <LogEntryItem key={idx} log={log} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export default ActivityLog
export type { LogEntry, LogTone }
