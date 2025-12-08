type PaymentScheme = '4mica-credit' | 'x402'

interface PaymentRailSelectorProps {
  paymentScheme: PaymentScheme
  onSchemeChange: (scheme: PaymentScheme) => void
}

const PaymentRailSelector = ({ paymentScheme, onSchemeChange }: PaymentRailSelectorProps) => {
  return (
    <div>
      <div className='flex items-center justify-between mb-3'>
        <span className='text-gray-200 font-semibold'>Payment rail</span>
        {paymentScheme === '4mica-credit' ? (
          <span className='text-xs text-emerald-400'>Recommended</span>
        ) : (
          <span className='text-xs text-indigo-300'>On-chain</span>
        )}
      </div>

      <div className='grid grid-cols-2 gap-3'>
        <button
          onClick={() => onSchemeChange('4mica-credit')}
          className={`rounded-lg px-4 py-3 border font-medium text-sm transition cursor-pointer ${
            paymentScheme === '4mica-credit'
              ? 'border-emerald-500 bg-emerald-900 text-white'
              : 'border-gray-600 bg-gray-800 text-gray-300 hover:border-gray-500'
          }`}
        >
          4mica credit
        </button>
        <button
          onClick={() => onSchemeChange('x402')}
          className={`rounded-lg px-4 py-3 border font-medium text-sm transition cursor-pointer ${
            paymentScheme === 'x402'
              ? 'border-indigo-500 bg-indigo-900 text-white'
              : 'border-gray-600 bg-gray-800 text-gray-300 hover:border-gray-500'
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
