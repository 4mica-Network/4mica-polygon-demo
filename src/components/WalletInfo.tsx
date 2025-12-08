interface TokenBalance {
  address: string
  symbol: string
  balance: string
  decimals: number
}

interface WalletInfoProps {
  address: string | null
  chainId: number | null
  balance: string | null
  balanceLoading: boolean
  tokenBalances: TokenBalance[]
  onWrongChain: boolean
  onCopyAddress: () => void
}

const formatAddress = (addr: string | null | undefined) => {
  if (!addr) return '—'
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`
}

const WalletInfo = ({
  address,
  chainId,
  balance,
  balanceLoading,
  tokenBalances,
  onWrongChain,
  onCopyAddress,
}: WalletInfoProps) => {
  return (
    <div className='bg-gray-900 border border-gray-700 rounded-xl p-5'>
      <div className='flex items-center justify-between text-sm text-gray-300 py-2 border-b border-gray-800'>
        <span>Wallet</span>
        <div className='flex items-center gap-2 text-xs text-gray-200'>
          <span className='font-medium'>{formatAddress(address)}</span>
          <button
            onClick={onCopyAddress}
            className='px-3 py-1.5 rounded-md bg-gray-800 border border-gray-600 text-xs text-white hover:bg-gray-700 transition cursor-pointer'
          >
            Copy
          </button>
        </div>
      </div>

      <div className='flex items-center justify-between text-sm text-gray-300 py-2 border-b border-gray-800'>
        <span>Network</span>
        <span className='px-3 py-1.5 rounded-full bg-indigo-900 text-indigo-200 text-xs'>Polygon Amoy</span>
      </div>

      <div className='flex items-center justify-between text-sm text-gray-300 py-2 border-b border-gray-800'>
        <span>Chain ID</span>
        <span className={onWrongChain ? 'text-yellow-400 font-semibold' : 'text-emerald-400 font-semibold'}>
          {chainId ?? 'Unknown'}
        </span>
      </div>

      <div className='flex items-center justify-between text-sm text-gray-300 py-2'>
        <span>Wallet balance</span>
        <span className='text-white font-semibold'>
          {balanceLoading ? 'Loading…' : balance ? `${Number(balance).toFixed(4)} POL` : '—'}
        </span>
      </div>

      {tokenBalances.length > 0 && (
        <div className='mt-4 pt-4 border-t border-gray-800'>
          <div className='text-sm text-gray-300 mb-2'>Token balances</div>
          <div className='flex flex-col gap-2'>
            {tokenBalances.map(tb => (
              <div
                key={tb.address}
                className='flex items-center justify-between text-xs bg-gray-800 border border-gray-700 rounded-md px-3 py-2'
              >
                <span className='text-gray-200'>{tb.symbol}</span>
                <span className='text-white font-semibold'>{Number(tb.balance).toFixed(4)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export default WalletInfo
export type { TokenBalance }
