import { PaymentGuaranteeRequestClaims, PaymentSignature, SigningScheme } from './models';
import { normalizeAddress, parseU256 } from './utils';
import { X402Error } from './errors';
import type { FetchFn } from './rpc';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

export interface PaymentRequirementsInit {
  scheme: string;
  network: string;
  maxAmountRequired: string;
  payTo: string;
  asset: string;
  extra?: Record<string, unknown>;
  resource?: string;
  description?: string;
  mimeType?: string;
  outputSchema?: unknown;
  maxTimeoutSeconds?: number;
}

export class PaymentRequirements {
  constructor(
    public scheme: string,
    public network: string,
    public maxAmountRequired: string,
    public payTo: string,
    public asset: string,
    public extra: Record<string, unknown>,
    public resource?: string,
    public description?: string,
    public mimeType?: string,
    public outputSchema?: unknown,
    public maxTimeoutSeconds?: number
  ) {}

  static fromRaw(raw: Record<string, unknown>): PaymentRequirements {
    const pick = <T>(keys: string[], defaultValue?: T) => {
      for (const key of keys) {
        const value = raw[key];
        if (value !== undefined && value !== null) return value as T;
      }
      return defaultValue;
    };

    const amount = pick(['maxAmountRequired', 'max_amount_required']);
    const payTo = pick(['payTo', 'pay_to']);
    const asset = pick(['asset', 'assetAddress', 'asset_address']);
    const scheme = pick<unknown>(['scheme']);
    const network = pick<unknown>(['network']);
    if (!amount || !payTo || !asset || !scheme || !network) {
      const missing = [
        ['scheme', scheme],
        ['network', network],
        ['maxAmountRequired', amount],
        ['payTo', payTo],
        ['asset', asset],
      ]
        .filter(([, value]) => !value)
        .map(([key]) => key)
        .join(', ');
      throw new X402Error(`payment requirements missing fields: ${missing}`);
    }

    return new PaymentRequirements(
      String(scheme),
      String(network),
      String(amount),
      String(payTo),
      String(asset),
      pick(['extra'], {}) ?? {},
      pick(['resource']),
      pick(['description']),
      pick(['mimeType', 'mime_type']),
      pick(['outputSchema', 'output_schema']),
      pick(['maxTimeoutSeconds', 'max_timeout_seconds'])
    );
  }

  toPayload(): Record<string, unknown> {
    const extraPayload: Record<string, unknown> = { ...(this.extra ?? {}) };
    if ('tab_endpoint' in extraPayload && !('tabEndpoint' in extraPayload)) {
      extraPayload['tabEndpoint'] = extraPayload['tab_endpoint'];
      delete extraPayload['tab_endpoint'];
    }
    const payload: Record<string, unknown> = {
      scheme: this.scheme,
      network: this.network,
      maxAmountRequired: this.maxAmountRequired,
      payTo: this.payTo,
      asset: this.asset,
      extra: extraPayload,
    };
    if (this.resource !== undefined) payload.resource = this.resource;
    if (this.description !== undefined) payload.description = this.description;
    if (this.mimeType !== undefined) payload.mimeType = this.mimeType;
    if (this.outputSchema !== undefined) payload.outputSchema = this.outputSchema;
    if (this.maxTimeoutSeconds !== undefined) payload.maxTimeoutSeconds = this.maxTimeoutSeconds;
    return payload;
  }
}

export class PaymentRequirementsExtra {
  constructor(public tabEndpoint?: string | null) {}

  static fromRaw(raw: Record<string, unknown> | undefined): PaymentRequirementsExtra {
    const tabEndpointRaw =
      (isRecord(raw) ? raw.tabEndpoint : undefined) ??
      (isRecord(raw) ? raw.tab_endpoint : undefined);
    const tabEndpoint =
      typeof tabEndpointRaw === 'string'
        ? tabEndpointRaw
        : tabEndpointRaw === null
          ? null
          : undefined;
    return new PaymentRequirementsExtra(tabEndpoint);
  }
}

export class TabResponse {
  constructor(
    public tabId: string,
    public userAddress: string
  ) {}
}

export class X402PaymentEnvelope {
  constructor(
    public x402Version: number,
    public scheme: string,
    public network: string,
    public payload: Record<string, unknown>
  ) {}

  toPayload(): Record<string, unknown> {
    return {
      x402Version: this.x402Version,
      scheme: this.scheme,
      network: this.network,
      payload: this.payload,
    };
  }
}

export class X402SignedPayment {
  constructor(
    public header: string,
    public claims: PaymentGuaranteeRequestClaims,
    public signature: PaymentSignature
  ) {}
}

export class X402SettledPayment {
  constructor(
    public payment: X402SignedPayment,
    public settlement: unknown
  ) {}
}

export interface FlowSigner {
  signPayment(
    claims: PaymentGuaranteeRequestClaims,
    scheme: SigningScheme
  ): Promise<PaymentSignature>;
}

export class X402Flow {
  private fetchFn: FetchFn;

  constructor(
    private signer: FlowSigner,
    fetchFn: FetchFn = fetch
  ) {
    this.fetchFn = fetchFn;
  }

  static fromClient(client: { user: FlowSigner }): X402Flow {
    return new X402Flow(client.user);
  }

  async signPayment(
    paymentRequirements: PaymentRequirements,
    userAddress: string,
    existingTabId?: bigint | number
  ): Promise<X402SignedPayment> {
    X402Flow.validateScheme(paymentRequirements.scheme);
    let tab: TabResponse;
    if (existingTabId !== undefined && existingTabId !== null) {
      tab = new TabResponse(String(existingTabId), userAddress);
    } else {
      tab = await this.requestTab(paymentRequirements, userAddress);
    }
    const claims = this.buildClaims(paymentRequirements, tab, userAddress);
    const signature = await this.signer.signPayment(claims, SigningScheme.EIP712);
    const envelope = X402Flow.buildEnvelope(paymentRequirements, claims, signature);
    const payload = envelope.toPayload();
    payload.x402Version ??= envelope.x402Version;
    const header = Buffer.from(JSON.stringify(payload)).toString('base64');
    return new X402SignedPayment(header, claims, signature);
  }

  async settlePayment(
    payment: X402SignedPayment,
    paymentRequirements: PaymentRequirements,
    facilitatorUrl: string
  ): Promise<X402SettledPayment> {
    const url = `${facilitatorUrl.replace(/\/$/, '')}/settle`;
    const response = await this.fetchFn(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        x402Version: 1,
        paymentHeader: payment.header,
        paymentRequirements: paymentRequirements.toPayload(),
      }),
    });
    const data = await response.text();
    if (!response.ok) {
      throw new X402Error(`settlement failed with status ${response.status}: ${data}`);
    }
    const settlement = data ? JSON.parse(data) : {};
    return new X402SettledPayment(payment, settlement);
  }

  protected async requestTab(
    paymentRequirements: PaymentRequirements,
    userAddress: string
  ): Promise<TabResponse> {
    const extra = PaymentRequirementsExtra.fromRaw(paymentRequirements.extra);
    if (!extra.tabEndpoint) {
      throw new X402Error('missing tabEndpoint in paymentRequirements.extra');
    }
    const resp = await this.fetchFn(extra.tabEndpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        userAddress,
        paymentRequirements: paymentRequirements.toPayload(),
      }),
    });
    if (!resp.ok) {
      const text = await resp.text();
      throw new X402Error(`tab resolution failed: ${resp.status} ${text}`);
    }
    const body = await resp.json();
    return new TabResponse(body.tabId ?? body.tab_id, body.userAddress ?? body.user_address);
  }

  protected buildClaims(
    requirements: PaymentRequirements,
    tab: TabResponse,
    userAddress: string
  ): PaymentGuaranteeRequestClaims {
    const tabId = parseU256(tab.tabId);
    const amount = parseU256(requirements.maxAmountRequired);
    if (tab.userAddress.toLowerCase() !== userAddress.toLowerCase()) {
      throw new X402Error(
        `user mismatch in paymentRequirements: found ${tab.userAddress}, expected ${userAddress}`
      );
    }
    const timestamp = Math.floor(Date.now() / 1000);
    return PaymentGuaranteeRequestClaims.new(
      userAddress,
      normalizeAddress(requirements.payTo),
      tabId,
      amount,
      timestamp,
      requirements.asset
    );
  }

  private static validateScheme(scheme: string): void {
    if (!scheme.toLowerCase().includes('4mica')) {
      throw new X402Error(`invalid scheme: ${scheme}`);
    }
  }

  private static buildEnvelope(
    paymentRequirements: PaymentRequirements,
    claims: PaymentGuaranteeRequestClaims,
    signature: PaymentSignature
  ): X402PaymentEnvelope {
    const payload = {
      claims: {
        version: 'v1',
        user_address: claims.userAddress,
        recipient_address: claims.recipientAddress,
        tab_id: `0x${claims.tabId.toString(16)}`,
        amount: `0x${claims.amount.toString(16)}`,
        asset_address: claims.assetAddress,
        timestamp: claims.timestamp,
      },
      signature: signature.signature,
      scheme: signature.scheme,
    };
    return new X402PaymentEnvelope(
      1,
      paymentRequirements.scheme,
      paymentRequirements.network,
      payload
    );
  }
}
