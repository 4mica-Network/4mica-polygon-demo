const BootstrapLoader = () => {
  return (
    <div className='relative min-h-screen bg-gradient-to-br from-slate-950 via-indigo-950 to-slate-900 flex items-center justify-center p-6 overflow-hidden'>
      <div className='absolute -top-40 -right-24 h-80 w-80 bg-indigo-500/30 blur-3xl rounded-full pointer-events-none' />
      <div className='absolute -bottom-32 -left-10 h-80 w-80 bg-emerald-500/20 blur-3xl rounded-full pointer-events-none' />
      <div className='w-full max-w-3xl mx-auto text-center space-y-6 px-4'>
        <div className='inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-gray-800 border border-gray-600 text-xs uppercase tracking-wider text-indigo-200'>
          <span className='h-2.5 w-2.5 rounded-full bg-emerald-400 animate-pulse' />
          Restoring wallet session
        </div>
        <div className='text-2xl md:text-3xl text-white font-semibold leading-relaxed'>
          Checking for an existing connection…
        </div>
        <div className='text-gray-400 text-sm leading-relaxed max-w-lg mx-auto'>
          If you previously approved this site, your wallet will reconnect automatically.
        </div>
      </div>
    </div>
  )
}

export default BootstrapLoader
