import { normalizeAddress, parseU256 } from './utils';

export enum SigningScheme {
  EIP712 = 'eip712',
  EIP191 = 'eip191',
}

export interface PaymentSignature {
  signature: string;
  scheme: SigningScheme;
}

export class PaymentGuaranteeRequestClaims {
  userAddress: string;
  recipientAddress: string;
  tabId: bigint;
  amount: bigint;
  timestamp: number;
  assetAddress: string;

  constructor(init: {
    userAddress: string;
    recipientAddress: string;
    tabId: bigint;
    amount: bigint;
    timestamp: number;
    assetAddress: string;
  }) {
    this.userAddress = init.userAddress;
    this.recipientAddress = init.recipientAddress;
    this.tabId = init.tabId;
    this.amount = init.amount;
    this.timestamp = init.timestamp;
    this.assetAddress = init.assetAddress;
  }

  static new(
    userAddress: string,
    recipientAddress: string,
    tabId: number | bigint | string,
    amount: number | bigint | string,
    timestamp: number,
    erc20Token?: string | null
  ): PaymentGuaranteeRequestClaims {
    const asset = erc20Token ?? '0x0000000000000000000000000000000000000000';
    return new PaymentGuaranteeRequestClaims({
      userAddress: normalizeAddress(userAddress),
      recipientAddress: normalizeAddress(recipientAddress),
      tabId: parseU256(tabId),
      amount: parseU256(amount),
      timestamp: Number(timestamp),
      assetAddress: normalizeAddress(asset),
    });
  }
}

export interface PaymentGuaranteeClaims {
  domain: Uint8Array;
  userAddress: string;
  recipientAddress: string;
  tabId: bigint;
  reqId: bigint;
  amount: bigint;
  totalAmount: bigint;
  assetAddress: string;
  timestamp: number;
  version: number;
}

export interface BLSCert {
  claims: string;
  signature: string;
}

export interface TabPaymentStatus {
  paid: bigint;
  remunerated: boolean;
  asset: string;
}

export interface UserInfo {
  asset: string;
  collateral: bigint;
  withdrawalRequestAmount: bigint;
  withdrawalRequestTimestamp: number;
}

function getAny<T>(raw: Record<string, unknown>, ...keys: string[]): T | undefined {
  for (const key of keys) {
    if (key in raw) return raw[key] as T;
  }
  return undefined;
}

export class TabInfo {
  constructor(
    public tabId: bigint,
    public userAddress: string,
    public recipientAddress: string,
    public assetAddress: string,
    public startTimestamp: number,
    public ttlSeconds: number,
    public status: string,
    public settlementStatus: string,
    public createdAt: number,
    public updatedAt: number
  ) {}

  static fromRpc(raw: Record<string, unknown>): TabInfo {
    return new TabInfo(
      parseU256((getAny(raw, 'tab_id', 'tabId') ?? 0) as number | bigint | string),
      (getAny(raw, 'user_address', 'userAddress') ?? '') as string,
      (getAny(raw, 'recipient_address', 'recipientAddress') ?? '') as string,
      (getAny(raw, 'asset_address', 'assetAddress') ?? '') as string,
      Number(getAny(raw, 'start_timestamp', 'startTimestamp')),
      Number(getAny(raw, 'ttl_seconds', 'ttlSeconds')),
      (getAny(raw, 'status') ?? '') as string,
      (getAny(raw, 'settlement_status', 'settlementStatus') ?? '') as string,
      Number(getAny(raw, 'created_at', 'createdAt')),
      Number(getAny(raw, 'updated_at', 'updatedAt'))
    );
  }
}

export class GuaranteeInfo {
  constructor(
    public tabId: bigint,
    public reqId: bigint,
    public fromAddress: string,
    public toAddress: string,
    public assetAddress: string,
    public amount: bigint,
    public timestamp: number,
    public certificate?: string | null
  ) {}

  static fromRpc(raw: Record<string, unknown>): GuaranteeInfo {
    return new GuaranteeInfo(
      parseU256((getAny(raw, 'tab_id', 'tabId') ?? 0) as number | bigint | string),
      parseU256((getAny(raw, 'req_id', 'reqId') ?? 0) as number | bigint | string),
      (getAny(raw, 'from_address', 'fromAddress') ?? '') as string,
      (getAny(raw, 'to_address', 'toAddress') ?? '') as string,
      (getAny(raw, 'asset_address', 'assetAddress') ?? '') as string,
      parseU256((getAny(raw, 'amount') ?? 0) as number | bigint | string),
      Number(getAny(raw, 'start_timestamp', 'startTimestamp', 'timestamp') ?? 0),
      getAny(raw, 'certificate')
    );
  }
}

export class PendingRemunerationInfo {
  constructor(
    public tab: TabInfo,
    public latestGuarantee?: GuaranteeInfo | null
  ) {}

  static fromRpc(raw: Record<string, unknown>): PendingRemunerationInfo {
    const latest = getAny<Record<string, unknown>>(raw, 'latest_guarantee', 'latestGuarantee');
    return new PendingRemunerationInfo(
      TabInfo.fromRpc(getAny(raw, 'tab') ?? {}),
      latest ? GuaranteeInfo.fromRpc(latest) : null
    );
  }
}

export class CollateralEventInfo {
  constructor(
    public id: string,
    public userAddress: string,
    public assetAddress: string,
    public amount: bigint,
    public eventType: string,
    public tabId?: bigint | null,
    public reqId?: bigint | null,
    public txId?: string | null,
    public createdAt: number = 0
  ) {}

  static fromRpc(raw: Record<string, unknown>): CollateralEventInfo {
    const tabId = getAny(raw, 'tab_id', 'tabId');
    const reqId = getAny(raw, 'req_id', 'reqId');
    return new CollateralEventInfo(
      (getAny(raw, 'id') ?? '') as string,
      (getAny(raw, 'user_address', 'userAddress') ?? '') as string,
      (getAny(raw, 'asset_address', 'assetAddress') ?? '') as string,
      parseU256((getAny(raw, 'amount') ?? 0) as number | bigint | string),
      (getAny(raw, 'event_type', 'eventType') ?? '') as string,
      tabId !== undefined && tabId !== null ? parseU256(tabId as number | bigint | string) : null,
      reqId !== undefined && reqId !== null ? parseU256(reqId as number | bigint | string) : null,
      getAny(raw, 'tx_id', 'txId'),
      Number(getAny(raw, 'created_at', 'createdAt') ?? 0)
    );
  }
}

export class AssetBalanceInfo {
  constructor(
    public userAddress: string,
    public assetAddress: string,
    public total: bigint,
    public locked: bigint,
    public version: number,
    public updatedAt: number
  ) {}

  static fromRpc(raw: Record<string, unknown>): AssetBalanceInfo {
    return new AssetBalanceInfo(
      (getAny(raw, 'user_address', 'userAddress') ?? '') as string,
      (getAny(raw, 'asset_address', 'assetAddress') ?? '') as string,
      parseU256((getAny(raw, 'total') ?? 0) as number | bigint | string),
      parseU256((getAny(raw, 'locked') ?? 0) as number | bigint | string),
      Number(getAny(raw, 'version') ?? 0),
      Number(getAny(raw, 'updated_at', 'updatedAt') ?? 0)
    );
  }
}

export class RecipientPaymentInfo {
  constructor(
    public userAddress: string,
    public recipientAddress: string,
    public txHash: string,
    public amount: bigint,
    public verified: boolean,
    public finalized: boolean,
    public failed: boolean,
    public createdAt: number
  ) {}

  static fromRpc(raw: Record<string, unknown>): RecipientPaymentInfo {
    return new RecipientPaymentInfo(
      (getAny(raw, 'user_address', 'userAddress') ?? '') as string,
      (getAny(raw, 'recipient_address', 'recipientAddress') ?? '') as string,
      (getAny(raw, 'tx_hash', 'txHash') ?? '') as string,
      parseU256((getAny(raw, 'amount') ?? 0) as number | bigint | string),
      Boolean(getAny(raw, 'verified')),
      Boolean(getAny(raw, 'finalized')),
      Boolean(getAny(raw, 'failed')),
      Number(getAny(raw, 'created_at', 'createdAt') ?? 0)
    );
  }
}
