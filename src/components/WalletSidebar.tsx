import CollateralCard, { type CollateralItem } from './CollateralCard'
import WalletInfo, { type TokenBalance } from './WalletInfo'
import PaymentRailSelector, { type PaymentScheme } from './PaymentRailSelector'

interface WalletSidebarProps {
  address: string | null
  chainId: number | null
  balance: string | null
  balanceLoading: boolean
  tokenBalances: TokenBalance[]
  collateral: CollateralItem[]
  collateralLoading: boolean
  primaryCollateral: CollateralItem | null
  paymentScheme: PaymentScheme
  onWrongChain: boolean
  onCopyAddress: () => void
  onSchemeChange: (scheme: PaymentScheme) => void
  onSwitchNetwork: () => void
}

const WalletSidebar = ({
  address,
  chainId,
  balance,
  balanceLoading,
  tokenBalances,
  collateral,
  collateralLoading,
  primaryCollateral,
  paymentScheme,
  onWrongChain,
  onCopyAddress,
  onSchemeChange,
  onSwitchNetwork,
}: WalletSidebarProps) => {
  return (
    <div className='bg-gray-800 border border-gray-700 rounded-2xl p-6 shadow-2xl flex flex-col gap-5'>
      <div className='flex flex-col gap-5'>
        <PaymentRailSelector paymentScheme={paymentScheme} onSchemeChange={onSchemeChange} />

        <div className='rounded-xl bg-gray-900 border border-gray-700 p-5 space-y-3'>
          <div className='text-gray-200 font-semibold'>
            {paymentScheme === '4mica-credit' ? '4mica credit mode' : 'x402 mode'}
          </div>
          <p className='text-sm text-gray-300 leading-relaxed'>
            {paymentScheme === '4mica-credit'
              ? 'Uses your configured 4mica credit balance; deposits are handled outside this demo.'
              : 'Pays per segment directly on-chain for the stream.'}
          </p>
          {onWrongChain ? (
            <button
              onClick={onSwitchNetwork}
              className='w-full rounded-lg bg-yellow-400 text-gray-900 py-3 font-semibold hover:bg-yellow-300 transition cursor-pointer'
            >
              Switch to Polygon Amoy
            </button>
          ) : (
            <div className='text-xs text-emerald-300 bg-emerald-900 border border-emerald-700 rounded-lg px-4 py-3'>
              Polygon Amoy ready.
            </div>
          )}
        </div>
      </div>

      {paymentScheme === '4mica-credit' && (
        <CollateralCard
          collateral={collateral}
          collateralLoading={collateralLoading}
          primaryCollateral={primaryCollateral}
        />
      )}

      <WalletInfo
        address={address}
        chainId={chainId}
        balance={balance}
        balanceLoading={balanceLoading}
        tokenBalances={tokenBalances}
        onWrongChain={onWrongChain}
        onCopyAddress={onCopyAddress}
      />
    </div>
  )
}

export default WalletSidebar
