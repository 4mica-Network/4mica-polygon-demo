import { signatureToWords } from './bls';
import { Config } from './config';
import { ContractGateway } from './contract';
import { ClientInitializationError, VerificationError } from './errors';
import { decodeGuaranteeClaims } from './guarantee';
import {
  AssetBalanceInfo,
  BLSCert,
  CollateralEventInfo,
  GuaranteeInfo,
  PaymentGuaranteeClaims,
  PaymentGuaranteeRequestClaims,
  PaymentSignature,
  PendingRemunerationInfo,
  RecipientPaymentInfo,
  SigningScheme,
  TabInfo,
  TabPaymentStatus,
  UserInfo,
} from './models';
import { RpcProxy } from './rpc';
import { CorePublicParameters, PaymentSigner } from './signing';
import { normalizeAddress, parseU256, serializeU256 } from './utils';

const isNumericLike = (value: unknown): value is number | bigint | string =>
  typeof value === 'number' || typeof value === 'bigint' || typeof value === 'string';

type RpcTabStatus = {
  paid?: number | bigint | string;
  paidAmount?: number | bigint | string;
  remunerated?: boolean;
  paidOut?: boolean;
  asset?: string;
  assetAddress?: string;
};

function tabStatusFromRpc(status: RpcTabStatus): TabPaymentStatus {
  const paid = status.paid !== undefined ? status.paid : (status.paidAmount ?? 0);
  const remunerated = status.remunerated ?? status.paidOut ?? false;
  const asset = status.asset ?? status.assetAddress ?? '';
  return {
    paid: parseU256(paid),
    remunerated: Boolean(remunerated),
    asset,
  };
}

export class Client {
  readonly rpc: RpcProxy;
  readonly params: CorePublicParameters;
  readonly gateway: ContractGateway;
  readonly guaranteeDomain: string;
  readonly user: UserClient;
  readonly recipient: RecipientClient;
  readonly signer: PaymentSigner;

  private constructor(
    cfg: Config,
    rpc: RpcProxy,
    params: CorePublicParameters,
    gateway: ContractGateway,
    guaranteeDomain: string,
    signer: PaymentSigner
  ) {
    this.rpc = rpc;
    this.params = params;
    this.gateway = gateway;
    this.guaranteeDomain = guaranteeDomain;
    this.signer = signer;
    this.user = new UserClient(this);
    this.recipient = new RecipientClient(this);
  }

  static async new(cfg: Config): Promise<Client> {
    const rpc = new RpcProxy(cfg.rpcUrl, cfg.adminApiKey);
    const params = await rpc.getPublicParams();
    const gateway = Client.buildGateway(cfg, params);
    await Client.validateChainId(gateway, params.chainId);
    const guaranteeDomain = await gateway.getGuaranteeDomain();
    const signer = new PaymentSigner(cfg.walletPrivateKey);
    return new Client(cfg, rpc, params, gateway, guaranteeDomain, signer);
  }

  private static buildGateway(cfg: Config, params: CorePublicParameters): ContractGateway {
    const ethRpcUrl = cfg.ethereumHttpRpcUrl ?? params.ethereumHttpRpcUrl;
    const contractAddress = cfg.contractAddress ?? params.contractAddress;
    return new ContractGateway(ethRpcUrl, cfg.walletPrivateKey, contractAddress, params.chainId);
  }

  private static async validateChainId(
    gateway: ContractGateway,
    expectedChainId: number
  ): Promise<void> {
    try {
      const chainId = await gateway.getChainId();
      if (Number(chainId) !== Number(expectedChainId)) {
        throw new ClientInitializationError(
          `chain id mismatch between core (${expectedChainId}) and provider (${chainId})`
        );
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      throw new ClientInitializationError(message);
    }
  }

  async aclose(): Promise<void> {
    await this.rpc.aclose();
  }
}

export class UserClient {
  constructor(private client: Client) {}

  get guaranteeDomain(): string {
    return this.client.guaranteeDomain;
  }

  async approveErc20(token: string, amount: number | bigint | string) {
    return this.client.gateway.approveErc20(token, amount);
  }

  async deposit(amount: number | bigint | string, erc20Token?: string) {
    return this.client.gateway.deposit(amount, erc20Token);
  }

  async getUser(): Promise<UserInfo[]> {
    const assets = await this.client.gateway.getUserAssets();
    return assets.map(
      (a) =>
        ({
          asset: a.asset,
          collateral: parseU256(a.collateral),
          withdrawalRequestAmount: parseU256(a.withdrawal_request_amount),
          withdrawalRequestTimestamp: Number(a.withdrawal_request_timestamp),
        }) satisfies UserInfo
    );
  }

  async getTabPaymentStatus(tabId: number | bigint): Promise<TabPaymentStatus> {
    const status = await this.client.gateway.getPaymentStatus(tabId);
    return tabStatusFromRpc(status);
  }

  async signPayment(
    claims: PaymentGuaranteeRequestClaims,
    scheme: SigningScheme = SigningScheme.EIP712
  ): Promise<PaymentSignature> {
    return this.client.signer.signRequest(this.client.params, claims, scheme);
  }

  async payTab(
    tabId: number | bigint,
    reqId: number | bigint,
    amount: number | bigint | string,
    recipientAddress: string,
    erc20Token?: string
  ) {
    if (erc20Token) {
      return this.client.gateway.payTabErc20(tabId, amount, erc20Token, recipientAddress);
    }
    return this.client.gateway.payTabEth(tabId, reqId, amount, recipientAddress);
  }

  async requestWithdrawal(amount: number | bigint | string, erc20Token?: string) {
    return this.client.gateway.requestWithdrawal(amount, erc20Token);
  }

  async cancelWithdrawal(erc20Token?: string) {
    return this.client.gateway.cancelWithdrawal(erc20Token);
  }

  async finalizeWithdrawal(erc20Token?: string) {
    return this.client.gateway.finalizeWithdrawal(erc20Token);
  }
}

export class RecipientClient {
  constructor(private client: Client) {}

  private get recipientAddress(): string {
    return normalizeAddress(this.client.gateway.wallet.address);
  }

  get guaranteeDomain(): string {
    return this.client.guaranteeDomain;
  }

  private checkSigner(expected: string): void {
    if (normalizeAddress(expected) !== this.recipientAddress) {
      throw new VerificationError('signer address does not match recipient address');
    }
  }

  async createTab(
    userAddress: string,
    recipientAddress: string,
    erc20Token: string | undefined | null,
    ttl?: number | null
  ): Promise<bigint> {
    this.checkSigner(recipientAddress);
    const body = {
      user_address: normalizeAddress(userAddress),
      recipient_address: normalizeAddress(recipientAddress),
      erc20_token: erc20Token ? normalizeAddress(erc20Token) : null,
      ttl: ttl ?? null,
    };
    const result = await this.client.rpc.createPaymentTab(body);
    const record = result as Record<string, unknown>;
    const tabIdRaw = record.id ?? record.tabId ?? record.tab_id;
    const tabId = isNumericLike(tabIdRaw) ? tabIdRaw : 0;
    return parseU256(tabId);
  }

  async getTabPaymentStatus(tabId: number | bigint): Promise<TabPaymentStatus> {
    const status = await this.client.gateway.getPaymentStatus(tabId);
    return tabStatusFromRpc(status);
  }

  async issuePaymentGuarantee(
    claims: PaymentGuaranteeRequestClaims,
    signature: string,
    scheme: SigningScheme
  ): Promise<BLSCert> {
    this.checkSigner(claims.recipientAddress);
    const payload = {
      claims: {
        version: 'v1',
        user_address: claims.userAddress,
        recipient_address: claims.recipientAddress,
        tab_id: serializeU256(claims.tabId),
        amount: serializeU256(claims.amount),
        asset_address: claims.assetAddress,
        timestamp: Number(claims.timestamp),
      },
      signature,
      scheme,
    };
    const cert = await this.client.rpc.issueGuarantee(payload);
    const record = cert as Record<string, unknown>;
    const certClaims = typeof record.claims === 'string' ? record.claims : '';
    const signatureOut = typeof record.signature === 'string' ? record.signature : '';
    return { claims: certClaims, signature: signatureOut };
  }

  verifyPaymentGuarantee(cert: BLSCert): PaymentGuaranteeClaims {
    const claims = decodeGuaranteeClaims(cert.claims);
    const domainHex = this.guaranteeDomain.startsWith('0x')
      ? this.guaranteeDomain.slice(2)
      : Buffer.from(this.guaranteeDomain).toString('hex');
    const claimsHex = Buffer.from(claims.domain).toString('hex');
    if (claimsHex !== domainHex) {
      throw new VerificationError('guarantee domain mismatch');
    }
    return claims;
  }

  async remunerate(cert: BLSCert) {
    this.verifyPaymentGuarantee(cert);
    const sigWords = signatureToWords(cert.signature);
    const claimsBytes = Buffer.from(cert.claims.replace(/^0x/, ''), 'hex');
    return this.client.gateway.remunerate(claimsBytes, sigWords);
  }

  async listSettledTabs(): Promise<TabInfo[]> {
    const tabs = await this.client.rpc.listSettledTabs(this.recipientAddress);
    return tabs.map((t) => TabInfo.fromRpc(t));
  }

  async listPendingRemunerations(): Promise<PendingRemunerationInfo[]> {
    const items = await this.client.rpc.listPendingRemunerations(this.recipientAddress);
    return items.map((item) => PendingRemunerationInfo.fromRpc(item));
  }

  async getTab(tabId: number | bigint): Promise<TabInfo | null> {
    const result = await this.client.rpc.getTab(tabId);
    return result ? TabInfo.fromRpc(result) : null;
  }

  async listRecipientTabs(settlementStatuses?: string[]): Promise<TabInfo[]> {
    const tabs = await this.client.rpc.listRecipientTabs(this.recipientAddress, settlementStatuses);
    return tabs.map((t) => TabInfo.fromRpc(t));
  }

  async getTabGuarantees(tabId: number | bigint): Promise<GuaranteeInfo[]> {
    const guarantees = await this.client.rpc.getTabGuarantees(tabId);
    return guarantees.map((g) => GuaranteeInfo.fromRpc(g));
  }

  async getLatestGuarantee(tabId: number | bigint): Promise<GuaranteeInfo | null> {
    const result = await this.client.rpc.getLatestGuarantee(tabId);
    return result ? GuaranteeInfo.fromRpc(result) : null;
  }

  async getGuarantee(
    tabId: number | bigint,
    reqId: number | bigint
  ): Promise<GuaranteeInfo | null> {
    const result = await this.client.rpc.getGuarantee(tabId, reqId);
    return result ? GuaranteeInfo.fromRpc(result) : null;
  }

  async listRecipientPayments(): Promise<RecipientPaymentInfo[]> {
    const payments = await this.client.rpc.listRecipientPayments(this.recipientAddress);
    return payments.map((p) => RecipientPaymentInfo.fromRpc(p));
  }

  async getCollateralEventsForTab(tabId: number | bigint): Promise<CollateralEventInfo[]> {
    const events = await this.client.rpc.getCollateralEventsForTab(tabId);
    return events.map((ev) => CollateralEventInfo.fromRpc(ev));
  }

  async getUserAssetBalance(
    userAddress: string,
    assetAddress: string
  ): Promise<AssetBalanceInfo | null> {
    const balance = await this.client.rpc.getUserAssetBalance(userAddress, assetAddress);
    return balance ? AssetBalanceInfo.fromRpc(balance) : null;
  }
}
