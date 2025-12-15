import { AbiCoder, Wallet, getBytes } from 'ethers';
import { SigningError } from './errors';
import { PaymentGuaranteeRequestClaims, PaymentSignature, SigningScheme } from './models';
import { ValidationError, normalizeAddress } from './utils';

export class CorePublicParameters {
  constructor(
    public publicKey: Uint8Array,
    public contractAddress: string,
    public ethereumHttpRpcUrl: string,
    public eip712Name: string,
    public eip712Version: string,
    public chainId: number
  ) {}

  static fromRpc(payload: Record<string, unknown>): CorePublicParameters {
    const pkRaw = payload.public_key ?? payload.publicKey;
    const pk =
      typeof pkRaw === 'string'
        ? getBytes(pkRaw)
        : pkRaw instanceof Uint8Array
          ? pkRaw
          : Array.isArray(pkRaw)
            ? Uint8Array.from(pkRaw as ArrayLike<number>)
            : new Uint8Array();
    return new CorePublicParameters(
      pk,
      String(payload.contract_address ?? payload.contractAddress ?? ''),
      String(payload.ethereum_http_rpc_url ?? payload.ethereumHttpRpcUrl ?? ''),
      (payload.eip712_name ?? payload.eip712Name ?? '4Mica') as string,
      (payload.eip712_version ?? payload.eip712Version ?? '1') as string,
      Number(payload.chain_id ?? payload.chainId)
    );
  }
}

function buildTypedMessage(params: CorePublicParameters, claims: PaymentGuaranteeRequestClaims) {
  return {
    types: {
      EIP712Domain: [
        { name: 'name', type: 'string' },
        { name: 'version', type: 'string' },
        { name: 'chainId', type: 'uint256' },
      ],
      SolGuaranteeRequestClaimsV1: [
        { name: 'user', type: 'address' },
        { name: 'recipient', type: 'address' },
        { name: 'tabId', type: 'uint256' },
        { name: 'amount', type: 'uint256' },
        { name: 'asset', type: 'address' },
        { name: 'timestamp', type: 'uint64' },
      ],
    },
    primaryType: 'SolGuaranteeRequestClaimsV1',
    domain: {
      name: params.eip712Name,
      version: params.eip712Version,
      chainId: params.chainId,
    },
    message: {
      user: claims.userAddress,
      recipient: claims.recipientAddress,
      tabId: Number(claims.tabId),
      amount: Number(claims.amount),
      asset: claims.assetAddress,
      timestamp: Number(claims.timestamp),
    },
  } as const;
}

function encodeEip191(claims: PaymentGuaranteeRequestClaims): Uint8Array {
  const payload = AbiCoder.defaultAbiCoder().encode(
    ['address', 'address', 'uint256', 'uint256', 'address', 'uint64'],
    [
      claims.userAddress,
      claims.recipientAddress,
      claims.tabId,
      claims.amount,
      claims.assetAddress,
      claims.timestamp,
    ]
  );
  return getBytes(payload);
}

export class PaymentSigner {
  private wallet: Wallet;

  constructor(privateKey: string) {
    this.wallet = new Wallet(privateKey);
  }

  async signRequest(
    params: CorePublicParameters,
    claims: PaymentGuaranteeRequestClaims,
    scheme: SigningScheme = SigningScheme.EIP712
  ): Promise<PaymentSignature> {
    if (normalizeAddress(this.wallet.address) !== normalizeAddress(claims.userAddress)) {
      throw new SigningError(
        `address mismatch: signer ${this.wallet.address} != claims.user_address ${claims.userAddress}`
      );
    }

    try {
      if (scheme === SigningScheme.EIP712) {
        const typed = buildTypedMessage(params, claims);
        const claimsTypes = [...typed.types.SolGuaranteeRequestClaimsV1];
        const signature = await this.wallet.signTypedData(
          typed.domain,
          { SolGuaranteeRequestClaimsV1: claimsTypes },
          typed.message
        );
        return { signature, scheme };
      }
      if (scheme === SigningScheme.EIP191) {
        const message = encodeEip191(claims);
        const signature = await this.wallet.signMessage(message);
        return { signature, scheme };
      }
      throw new SigningError(`unsupported signing scheme: ${scheme}`);
    } catch (err: unknown) {
      if (err instanceof ValidationError) {
        throw new SigningError(err.message);
      }
      const message = err instanceof Error ? err.message : String(err);
      throw new SigningError(message);
    }
  }
}
