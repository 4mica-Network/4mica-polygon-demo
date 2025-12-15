import { AbiCoder, getBytes } from 'ethers';
import { VerificationError } from './errors';
import { PaymentGuaranteeClaims } from './models';
import { parseU256 } from './utils';

const CLAIM_TYPES = [
  'bytes32',
  'uint256',
  'uint256',
  'address',
  'address',
  'uint256',
  'uint256',
  'address',
  'uint64',
  'uint64',
];

const coder = AbiCoder.defaultAbiCoder();

function ensureDomainBytes(domain: string | Uint8Array): Uint8Array {
  const bytes = typeof domain === 'string' ? getBytes(domain) : domain;
  if (bytes.length !== 32) {
    throw new VerificationError('domain separator must be 32 bytes');
  }
  return bytes;
}

export function encodeGuaranteeClaims(claims: PaymentGuaranteeClaims): string {
  if (claims.version !== 1) {
    throw new VerificationError(`unsupported guarantee claims version: ${claims.version}`);
  }

  const domain = ensureDomainBytes(claims.domain);
  const encoded = coder.encode(CLAIM_TYPES, [
    domain,
    parseU256(claims.tabId),
    parseU256(claims.reqId),
    claims.userAddress,
    claims.recipientAddress,
    parseU256(claims.amount),
    parseU256(claims.totalAmount),
    claims.assetAddress,
    BigInt(claims.timestamp),
    BigInt(claims.version),
  ]);
  return coder.encode(['uint64', 'bytes'], [BigInt(claims.version), encoded]);
}

export function decodeGuaranteeClaims(data: string | Uint8Array): PaymentGuaranteeClaims {
  const rawBytes = typeof data === 'string' ? getBytes(data) : data;
  const [version, encoded] = coder.decode(['uint64', 'bytes'], rawBytes) as unknown as [
    bigint,
    string,
  ];
  if (version !== 1n) {
    throw new VerificationError(`unsupported guarantee claims version: ${version}`);
  }

  const [
    domain,
    tabId,
    reqId,
    user,
    recipient,
    amount,
    totalAmount,
    asset,
    timestamp,
    claimsVersion,
  ] = coder.decode(CLAIM_TYPES, encoded) as unknown as [
    string,
    bigint,
    bigint,
    string,
    string,
    bigint,
    bigint,
    string,
    bigint,
    bigint,
  ];

  return {
    domain: getBytes(domain),
    userAddress: user,
    recipientAddress: recipient,
    tabId: parseU256(tabId),
    reqId: parseU256(reqId),
    amount: parseU256(amount),
    totalAmount: parseU256(totalAmount),
    assetAddress: asset,
    timestamp: Number(timestamp),
    version: Number(claimsVersion),
  };
}
