import CollateralCard, { type CollateralItem } from './CollateralCard'
import WalletInfo, { type TokenBalance } from './WalletInfo'
import PaymentRailSelector, { type PaymentScheme } from './PaymentRailSelector'
import DepositForm from './DepositForm'

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
  depositMode: 'default' | 'custom'
  depositAmount: string
  tokenAddress: string
  tokenDecimals: string
  defaultTokenAddress: string
  depositLoading: boolean
  paramsLoading: boolean
  onWrongChain: boolean
  onCopyAddress: () => void
  onSchemeChange: (scheme: PaymentScheme) => void
  onDepositModeChange: (mode: 'default' | 'custom') => void
  onDepositAmountChange: (amount: string) => void
  onTokenAddressChange: (address: string) => void
  onTokenDecimalsChange: (decimals: string) => void
  onDeposit: () => void
  onSwitchNetwork: () => void
  onDisconnect: () => void
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
  depositMode,
  depositAmount,
  tokenAddress,
  tokenDecimals,
  defaultTokenAddress,
  depositLoading,
  paramsLoading,
  onWrongChain,
  onCopyAddress,
  onSchemeChange,
  onDepositModeChange,
  onDepositAmountChange,
  onTokenAddressChange,
  onTokenDecimalsChange,
  onDeposit,
  onSwitchNetwork,
  onDisconnect,
}: WalletSidebarProps) => {
  return (
    <div className='bg-gray-800 border border-gray-700 rounded-2xl p-6 shadow-2xl flex flex-col gap-5'>
      <CollateralCard
        collateral={collateral}
        collateralLoading={collateralLoading}
        primaryCollateral={primaryCollateral}
      />

      <WalletInfo
        address={address}
        chainId={chainId}
        balance={balance}
        balanceLoading={balanceLoading}
        tokenBalances={tokenBalances}
        onWrongChain={onWrongChain}
        onCopyAddress={onCopyAddress}
      />

      <div className='flex flex-col gap-5'>
        <PaymentRailSelector paymentScheme={paymentScheme} onSchemeChange={onSchemeChange} />

        {paymentScheme === '4mica-credit' ? (
          <DepositForm
            depositMode={depositMode}
            depositAmount={depositAmount}
            tokenAddress={tokenAddress}
            tokenDecimals={tokenDecimals}
            defaultTokenAddress={defaultTokenAddress}
            depositLoading={depositLoading}
            paramsLoading={paramsLoading}
            onWrongChain={onWrongChain}
            onDepositModeChange={onDepositModeChange}
            onDepositAmountChange={onDepositAmountChange}
            onTokenAddressChange={onTokenAddressChange}
            onTokenDecimalsChange={onTokenDecimalsChange}
            onDeposit={onDeposit}
            onSwitchNetwork={onSwitchNetwork}
          />
        ) : (
          <div className='rounded-xl bg-gray-900 border border-gray-700 p-5'>
            <div className='text-gray-200 font-semibold mb-3'>x402 mode</div>
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
        )}
      </div>

      <button
        onClick={onDisconnect}
        className='mt-auto px-4 py-3 rounded-lg bg-red-600 text-white font-medium shadow-lg shadow-red-600/30 hover:bg-red-500 hover:shadow-xl hover:shadow-red-500/40 transition-all cursor-pointer'
      >
        Disconnect
      </button>
    </div>
  )
}

export default WalletSidebar
