interface NetworkSwitchBannerProps {
  chainId: number | null
  isConnecting: boolean
  onSwitchNetwork: () => void
}

const NetworkSwitchBanner = ({ chainId, isConnecting, onSwitchNetwork }: NetworkSwitchBannerProps) => {
  return (
    <div className='bg-amber-900 border border-amber-600 rounded-xl p-6 flex flex-col gap-4'>
      <div>
        <div className='text-amber-100 font-semibold text-lg mb-2'>Switch to Polygon Amoy</div>
        <div className='text-amber-200 text-sm leading-relaxed'>
          You are on chain {chainId}. Switch to 80002 (Polygon Amoy) to continue streaming and signing payments.
        </div>
      </div>
      <button
        onClick={onSwitchNetwork}
        disabled={isConnecting}
        className='self-start px-5 py-3 rounded-lg bg-yellow-400 text-gray-900 font-semibold hover:bg-yellow-300 transition disabled:opacity-50 cursor-pointer'
      >
        Switch network
      </button>
    </div>
  )
}

export default NetworkSwitchBanner
