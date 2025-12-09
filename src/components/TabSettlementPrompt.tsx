interface TabSettlementPromptProps {
  tabLabel: string
  amountLabel: string
  visible: boolean
  settling: boolean
  onSettle: () => void
  onDismiss: () => void
}

const TabSettlementPrompt = ({ tabLabel, amountLabel, visible, settling, onSettle, onDismiss }: TabSettlementPromptProps) => {
  if (!visible) return null

  return (
    <div className='fixed bottom-5 right-5 z-50 max-w-md w-[360px] drop-shadow-2xl'>
      <div className='rounded-2xl border border-amber-400/70 bg-gradient-to-br from-amber-900/80 via-slate-950 to-black p-5 text-white shadow-amber-500/30 shadow-xl'>
        <div className='flex items-start gap-3'>
          <div className='mt-1 h-2 w-2 rounded-full bg-amber-300 shadow-[0_0_12px_rgba(251,191,36,0.8)]' />
          <div className='flex-1 space-y-1'>
            <div className='text-xs uppercase tracking-[0.2em] text-amber-200/80'>4mica tab open</div>
            <div className='text-lg font-semibold leading-tight'>Tab #{tabLabel}</div>
            <p className='text-sm text-amber-100/80 leading-relaxed'>
              Settle {amountLabel} before closing this window to avoid leaving the tab unpaid.
            </p>
          </div>
        </div>

        <div className='mt-4 flex items-center gap-3'>
          <button
            onClick={onSettle}
            disabled={settling}
            className='px-4 py-2 rounded-lg bg-amber-400 text-gray-900 font-semibold shadow-lg shadow-amber-400/40 hover:bg-amber-300 transition disabled:opacity-70 disabled:cursor-not-allowed'
          >
            {settling ? 'Settling…' : 'Settle tab now'}
          </button>
          <button
            onClick={onDismiss}
            className='px-3 py-2 rounded-lg border border-amber-300/60 text-amber-100/90 hover:border-amber-200 hover:text-amber-50 transition'
          >
            Later
          </button>
        </div>
      </div>
    </div>
  )
}

export default TabSettlementPrompt
