interface ConnectScreenProps {
  isConnecting: boolean
  error: string | null
  onConnect: () => void
}

const FeatureCard = ({
  title,
  subtitle,
  description,
  accentColor,
}: {
  title: string
  subtitle: string
  description: string
  accentColor: 'indigo' | 'emerald' | 'blue'
}) => {
  const colorMap = {
    indigo: 'text-indigo-200',
    emerald: 'text-emerald-200',
    blue: 'text-blue-200',
  }

  return (
    <div className='rounded-2xl border border-gray-700 bg-gray-800 p-5 shadow-lg'>
      <div className={`text-xs uppercase tracking-wider ${colorMap[accentColor]} mb-2`}>{title}</div>
      <div className='text-white font-semibold text-sm flex items-center gap-2'>
        {accentColor === 'indigo' && <span className='h-2 w-2 rounded-full bg-emerald-400 animate-pulse' />}
        {subtitle}
      </div>
      <div className='text-xs text-gray-400 mt-3 leading-relaxed'>{description}</div>
    </div>
  )
}

const StepCard = ({ title, description }: { title: string; description: string }) => (
  <div className='rounded-lg border border-gray-700 bg-gray-800 p-4'>
    <div className='font-semibold text-white mb-1.5'>{title}</div>
    <div className='text-gray-400 leading-relaxed text-xs'>{description}</div>
  </div>
)

const ConnectScreen = ({ isConnecting, error, onConnect }: ConnectScreenProps) => {
  return (
    <div className='relative z-10 grid lg:grid-cols-2 gap-12 items-center'>
      <div className='space-y-8'>
        <div className='inline-flex items-center gap-2 px-4 py-2 rounded-full bg-gray-800 border border-gray-600 text-xs uppercase tracking-wider text-indigo-200'>
          <span className='h-2.5 w-2.5 rounded-full bg-emerald-400 animate-pulse' />
          Live on Polygon Amoy
        </div>

        <div className='space-y-4'>
          <h2 className='text-3xl md:text-4xl text-white font-semibold leading-tight'>
            Stream instantly with a wallet tap
          </h2>
          <p className='text-gray-300 text-lg leading-relaxed max-w-xl'>
            Connect your wallet and start playback without forms or friction. Settlement runs in the background while
            you stay focused on the stream.
          </p>
        </div>

        <div className='grid sm:grid-cols-3 gap-4'>
          <FeatureCard
            title='Network check'
            subtitle='Amoy pre-set'
            description='Auto-detects the target chain and prompts a switch if needed.'
            accentColor='indigo'
          />
          <FeatureCard
            title='Privacy'
            subtitle='Sign only'
            description='Connection uses message signing; no spending approvals requested here.'
            accentColor='emerald'
          />
          <FeatureCard
            title='Focus'
            subtitle='Playback first'
            description='Wallet stays connected while x402 handles per-segment payments.'
            accentColor='blue'
          />
        </div>

        <div className='flex items-start gap-4 text-sm text-gray-300 max-w-xl'>
          <div className='h-10 w-10 rounded-xl bg-gray-800 border border-gray-600 flex items-center justify-center text-lg shrink-0'>
            ✓
          </div>
          <div>
            <div className='font-semibold text-white mb-1'>Fast start, clear safety</div>
            <div className='text-gray-400 leading-relaxed'>
              Single primary action to connect, visible chain badge, and reassurance that keys stay local.
            </div>
          </div>
        </div>
      </div>

      <div className='relative'>
        <div className='absolute -inset-8 bg-gradient-to-br from-indigo-600/30 via-blue-600/20 to-emerald-600/20 blur-3xl opacity-60 rounded-3xl' />

        <div className='relative bg-gray-900 border border-gray-700 rounded-3xl p-8 shadow-2xl backdrop-blur'>
          <div className='flex items-center justify-between mb-8'>
            <div>
              <div className='text-white text-xl font-semibold'>Connect your wallet</div>
              <div className='text-gray-400 text-sm mt-1'>Choose a provider and approve the prompt</div>
            </div>
            <div className='px-3 py-1.5 rounded-full text-xs bg-gray-800 border border-gray-600 text-gray-200'>
              Step 1
            </div>
          </div>

          <div className='rounded-2xl border border-gray-700 bg-gradient-to-br from-gray-800 via-gray-850 to-indigo-900/30 p-6 space-y-5'>
            <div className='flex items-center justify-between'>
              <div className='text-sm text-gray-300'>Connection state</div>
              <span className='px-3 py-1.5 rounded-full text-xs border border-gray-600 text-gray-200 bg-gray-800'>
                {isConnecting ? 'Awaiting approval…' : 'Ready to connect'}
              </span>
            </div>

            <div className='rounded-xl border border-gray-700 bg-black px-5 py-4 flex items-center justify-between'>
              <div>
                <div className='text-xs uppercase tracking-wider text-gray-400 mb-1'>Chain</div>
                <div className='text-white font-semibold flex items-center gap-2'>
                  <span className='h-2 w-2 rounded-full bg-emerald-400 animate-pulse' />
                  Polygon Amoy • 80002
                </div>
              </div>
              <div className='text-xs px-3 py-1.5 rounded-full bg-emerald-900 text-emerald-200 border border-emerald-700'>
                Synced
              </div>
            </div>

            <div className='grid sm:grid-cols-3 gap-3 text-xs text-gray-300'>
              <StepCard title='Pick wallet' description='Metamask, WalletConnect, or any injected EVM.' />
              <StepCard title='Approve' description='Review and sign the connect request.' />
              <StepCard title='Start streaming' description='Playback continues while on-chain payments run.' />
            </div>

            <button
              onClick={onConnect}
              className='w-full px-5 py-4 rounded-2xl bg-gradient-to-r from-indigo-600 via-blue-600 to-emerald-500 text-white text-base font-semibold shadow-lg hover:shadow-xl hover:from-indigo-500 hover:via-blue-500 hover:to-emerald-400 transition-all disabled:opacity-60 cursor-pointer'
              disabled={isConnecting}
            >
              {isConnecting ? 'Connecting...' : 'Connect wallet'}
            </button>

            {error && <div className='text-sm text-red-400 text-center py-1'>{error}</div>}

            <div className='text-xs text-gray-400 text-center'>
              No approvals to spend; this step is for access only.
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default ConnectScreen
