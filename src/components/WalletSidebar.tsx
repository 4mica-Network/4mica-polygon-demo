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
  openTab: { tabId: bigint; symbol: string } | null
  tabLabel: string
  tabAmountLabel: string
  settlingTab: boolean
  onCopyAddress: () => void
  onSchemeChange: (scheme: PaymentScheme) => void
  onDepositModeChange: (mode: 'default' | 'custom') => void
  onDepositAmountChange: (amount: string) => void
  onTokenAddressChange: (address: string) => void
  onTokenDecimalsChange: (decimals: string) => void
  onDeposit: () => void
  onSwitchNetwork: () => void
  onDisconnect: () => void
  onSettleTab: () => void
  onShowSettlePrompt: () => void
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
  openTab,
  tabAmountLabel,
  settlingTab,
  onCopyAddress,
  onSchemeChange,
  onDepositModeChange,
  onDepositAmountChange,
  onTokenAddressChange,
  onTokenDecimalsChange,
  onDeposit,
  onSwitchNetwork,
  onDisconnect,
  tabLabel,
  onSettleTab,
  onShowSettlePrompt,
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

        {openTab && (
          <div className='rounded-xl border border-amber-400/70 bg-gradient-to-br from-amber-900/60 via-slate-950 to-black p-4 shadow-amber-500/30 shadow-lg'>
            <div className='flex items-start gap-3'>
              <div className='mt-1 h-2 w-2 rounded-full bg-amber-300 shadow-[0_0_12px_rgba(251,191,36,0.8)]' />
              <div className='flex-1'>
                <div className='text-xs uppercase tracking-[0.2em] text-amber-200/80'>Open 4mica tab</div>
                <div className='text-sm font-semibold text-white mt-1'>
                  Tab #{tabLabel} · {tabAmountLabel || `${openTab.symbol} due`}
                </div>
                <div className='text-xs text-amber-100/80 mt-1'>
                  Settle before closing this page to avoid leaving an unpaid balance.
                </div>
              </div>
            </div>

            <div className='mt-3 flex flex-wrap items-center gap-3'>
              <button
                onClick={onSettleTab}
                disabled={settlingTab}
                className='px-4 py-2 rounded-lg bg-amber-400 text-gray-900 font-semibold shadow-lg shadow-amber-400/40 hover:bg-amber-300 transition disabled:opacity-70 disabled:cursor-not-allowed'
              >
                {settlingTab ? 'Settling…' : 'Settle now'}
              </button>
              <button
                onClick={onShowSettlePrompt}
                className='px-3 py-2 rounded-lg border border-amber-300/60 text-amber-100/90 hover:border-amber-200 hover:text-amber-50 transition'
              >
                Review & remind me
              </button>
            </div>
          </div>
        )}

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
