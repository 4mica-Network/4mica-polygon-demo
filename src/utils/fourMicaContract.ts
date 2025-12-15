import { Contract, JsonRpcProvider, JsonRpcSigner, ZeroAddress, hexlify, toBeHex, toUtf8Bytes, type Provider } from 'ethers'

const CORE_ABI = [
  'function deposit() payable',
  'function depositStablecoin(address asset, uint256 amount)',
  'function payTabInERC20Token(uint256 tab_id, address asset, uint256 amount, address recipient)',
  'function getPaymentStatus(uint256 tab_id) view returns (uint256 paid, bool remunerated, address asset)',
  'function getUserAllAssets(address user) view returns (tuple(address asset, uint256 collateral, uint256 withdrawal_request_timestamp, uint256 withdrawal_request_amount)[])',
]

const ERC20_ABI = [
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
]

export const ZERO_ADDRESS = ZeroAddress

export const getProvider = (signer?: JsonRpcSigner | null, rpcUrl?: string) => {
  if (signer?.provider) return signer.provider
  if (rpcUrl) return new JsonRpcProvider(rpcUrl)
  return null
}

export const getCoreContract = (address: string, signerOrProvider: JsonRpcSigner | Provider) =>
  new Contract(address, CORE_ABI, signerOrProvider)

export const getErc20Contract = (address: string, signerOrProvider: JsonRpcSigner | Provider) =>
  new Contract(address, ERC20_ABI, signerOrProvider)

export const encodeNativeTabMemo = (tabId: bigint, reqId: bigint) =>
  hexlify(toUtf8Bytes(`tab_id:${toBeHex(tabId)};req_id:${toBeHex(reqId)}`))
