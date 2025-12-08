interface DepositFormProps {
  depositMode: 'default' | 'custom'
  depositAmount: string
  tokenAddress: string
  tokenDecimals: string
  defaultTokenAddress: string
  depositLoading: boolean
  paramsLoading: boolean
  onWrongChain: boolean
  onDepositModeChange: (mode: 'default' | 'custom') => void
  onDepositAmountChange: (amount: string) => void
  onTokenAddressChange: (address: string) => void
  onTokenDecimalsChange: (decimals: string) => void
  onDeposit: () => void
  onSwitchNetwork: () => void
}

const DepositForm = ({
  depositMode,
  depositAmount,
  tokenAddress,
  tokenDecimals,
  defaultTokenAddress,
  depositLoading,
  paramsLoading,
  onWrongChain,
  onDepositModeChange,
  onDepositAmountChange,
  onTokenAddressChange,
  onTokenDecimalsChange,
  onDeposit,
  onSwitchNetwork,
}: DepositFormProps) => {
  return (
    <div className='flex flex-col gap-4'>
      <div className='flex items-center justify-between'>
        <span className='text-gray-200 font-semibold'>Deposit to 4mica</span>
        <span className='text-xs text-gray-400'>Default: USDC</span>
      </div>

      <div className='grid grid-cols-2 gap-3'>
        <button
          onClick={() => onDepositModeChange('default')}
          className={`rounded-lg px-4 py-3 border font-medium text-sm transition cursor-pointer ${
            depositMode === 'default'
              ? 'border-emerald-500 bg-emerald-900 text-white'
              : 'border-gray-600 bg-gray-800 text-gray-300 hover:border-gray-500'
          }`}
        >
          USDC (default)
        </button>
        <button
          onClick={() => onDepositModeChange('custom')}
          className={`rounded-lg px-4 py-3 border font-medium text-sm transition cursor-pointer ${
            depositMode === 'custom'
              ? 'border-indigo-500 bg-indigo-900 text-white'
              : 'border-gray-600 bg-gray-800 text-gray-300 hover:border-gray-500'
          }`}
        >
          Custom token
        </button>
      </div>

      {depositMode === 'default' ? (
        <div className='text-xs text-gray-300 leading-relaxed'>
          Using USDC (6 decimals)
          {defaultTokenAddress && <div className='mt-1.5 break-all text-gray-400'>Address: {defaultTokenAddress}</div>}
        </div>
      ) : (
        <>
          <div>
            <label className='block text-xs text-gray-400 mb-2'>Token address</label>
            <input
              value={tokenAddress}
              onChange={e => onTokenAddressChange(e.target.value)}
              placeholder='Token address (0x...)'
              className='w-full rounded-lg bg-gray-900 border border-gray-600 px-4 py-3 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent'
            />
          </div>
          <div>
            <label className='block text-xs text-gray-400 mb-2'>Token decimals (e.g., 6 or 18)</label>
            <input
              type='number'
              min='0'
              max='36'
              value={tokenDecimals}
              onChange={e => onTokenDecimalsChange(e.target.value)}
              placeholder='Token decimals'
              className='w-full rounded-lg bg-gray-900 border border-gray-600 px-4 py-3 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent'
            />
          </div>
        </>
      )}

      <div>
        <label className='block text-xs text-gray-400 mb-2'>Deposit amount</label>
        <input
          type='number'
          min='0'
          step='0.01'
          value={depositAmount}
          onChange={e => onDepositAmountChange(e.target.value)}
          placeholder='Amount to deposit'
          className='w-full rounded-lg bg-gray-900 border border-gray-600 px-4 py-3 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent'
        />
      </div>

      <button
        onClick={onDeposit}
        disabled={depositLoading || onWrongChain || paramsLoading}
        className='w-full rounded-xl bg-blue-600 text-white py-3 font-semibold shadow-lg shadow-blue-600/30 hover:bg-blue-500 hover:shadow-xl hover:shadow-blue-500/40 transition-all disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none cursor-pointer'
      >
        {depositLoading ? 'Depositing...' : 'Deposit'}
      </button>

      {paramsLoading && <div className='text-xs text-gray-400'>Loading 4mica contract params…</div>}

      <div className='text-xs text-gray-400 leading-relaxed'>
        Deposits call the 4mica core contract on Polygon Amoy using your connected wallet.
      </div>

      {onWrongChain && (
        <button
          onClick={onSwitchNetwork}
          className='w-full rounded-lg bg-yellow-400 text-gray-900 py-3 font-semibold hover:bg-yellow-300 transition cursor-pointer'
        >
          Switch to Polygon Amoy
        </button>
      )}
    </div>
  )
}

export default DepositForm
