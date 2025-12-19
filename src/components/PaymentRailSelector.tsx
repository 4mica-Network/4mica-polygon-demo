type PaymentScheme = '4mica-credit' | 'x402'

interface PaymentRailSelectorProps {
  paymentScheme: PaymentScheme
  onSchemeChange: (scheme: PaymentScheme) => void
}

const PaymentRailSelector = ({ paymentScheme, onSchemeChange }: PaymentRailSelectorProps) => {
  return (
    <div>
      <div className='flex items-center justify-between mb-3'>
        <span className='text-gray-100 font-semibold text-lg'>Payment rail</span>
        {paymentScheme === '4mica-credit' ? (
          <span className='text-sm text-emerald-300 font-medium'>Recommended</span>
        ) : (
          <span className='text-sm text-indigo-200 font-medium'>On-chain</span>
        )}
      </div>

      <div className='grid grid-cols-2 gap-3'>
        <button
          onClick={() => onSchemeChange('4mica-credit')}
          className={`rounded-lg px-4 py-3 border font-semibold text-sm md:text-base tracking-wide whitespace-nowrap transition cursor-pointer focus:outline-none focus:ring-2 focus:ring-offset-0 ${
            paymentScheme === '4mica-credit'
              ? 'border-emerald-400 bg-emerald-900 text-white shadow-lg shadow-emerald-500/30 focus:ring-emerald-300'
              : 'border-gray-600 bg-gray-800 text-gray-100 hover:border-gray-500 focus:ring-gray-500/50'
          }`}
        >
          4mica credit
        </button>
        <button
          onClick={() => onSchemeChange('x402')}
          className={`rounded-lg px-4 py-3 border font-semibold text-sm md:text-base tracking-wide whitespace-nowrap transition cursor-pointer focus:outline-none focus:ring-2 focus:ring-offset-0 ${
            paymentScheme === 'x402'
              ? 'border-indigo-400 bg-indigo-900 text-white shadow-lg shadow-indigo-500/30 focus:ring-indigo-300'
              : 'border-gray-600 bg-gray-800 text-gray-100 hover:border-gray-500 focus:ring-gray-500/50'
          }`}
        >
          x402
        </button>
      </div>

      {paymentScheme === '4mica-credit' && (
        <div className='mt-3 text-xs text-gray-400 leading-relaxed'>
          Lower gas footprint; uses your 4mica credit balance to keep playback uninterrupted.
        </div>
      )}
    </div>
  )
}

export default PaymentRailSelector
export type { PaymentScheme }
