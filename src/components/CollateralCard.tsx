interface CollateralItem {
  asset: string
  symbol: string
  decimals: number
  collateral: string
  locked: string
  withdrawalRequested: string
}

interface CollateralCardProps {
  collateral: CollateralItem[]
  collateralLoading: boolean
  primaryCollateral: CollateralItem | null
}

const CollateralCard = ({ collateral, collateralLoading, primaryCollateral }: CollateralCardProps) => {
  return (
    <div className='rounded-2xl bg-gradient-to-br from-emerald-900 via-teal-900 to-indigo-900 border border-emerald-600 p-5 shadow-lg'>
      <div className='flex items-start justify-between mb-3'>
        <div className='flex flex-col gap-1'>
          <div className='flex items-center gap-3 flex-wrap'>
            <div className='text-3xl font-semibold text-white'>
              {primaryCollateral
                ? `${Number(primaryCollateral.collateral || '0').toLocaleString(undefined, {
                    maximumFractionDigits: 4,
                  })} ${primaryCollateral.symbol}`
                : '0'}
            </div>
          </div>
        </div>
        <div
          className={`px-3 py-1 rounded-full text-xs border ${
            collateral.length
              ? 'bg-emerald-800 border-emerald-500 text-emerald-200'
              : 'bg-gray-800 border-gray-600 text-gray-300'
          }`}
        >
          {collateralLoading ? 'Syncing' : collateral.length ? 'Live' : 'No collateral'}
        </div>
      </div>

      <div className='text-xs text-emerald-300 mb-4'>6% APY</div>

      {primaryCollateral && Number(primaryCollateral.withdrawalRequested) > 0 && (
        <div className='mb-3 text-xs text-amber-200 bg-amber-900 border border-amber-600 rounded-lg px-4 py-3'>
          Withdrawal pending: {Number(primaryCollateral.withdrawalRequested).toFixed(4)} {primaryCollateral.symbol}
        </div>
      )}

      <div className='flex flex-col gap-2'>
        {collateral.length === 0 && (
          <div className='text-sm text-gray-200 bg-gray-800 border border-gray-600 rounded-lg px-4 py-4'>
            No collateral on 4Mica yet. Deposit to keep playback uninterrupted.
          </div>
        )}
        {collateral.map(item => (
          <div
            key={item.asset}
            className='flex items-center justify-between text-sm bg-black border border-gray-700 rounded-lg px-4 py-3'
          >
            <div className='flex flex-col text-gray-200 font-medium'>
              <span>{item.symbol}</span>
              <span className='text-[11px] text-emerald-200'>Locked {Number(item.locked || '0').toFixed(4)}</span>
            </div>
            <div className='text-white font-semibold text-right'>{Number(item.collateral).toFixed(4)}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

export default CollateralCard
export type { CollateralItem }
