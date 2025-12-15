import { describe, expect, it } from 'vitest';
import { decodeGuaranteeClaims, encodeGuaranteeClaims } from '../src/guarantee';
import { PaymentGuaranteeClaims } from '../src/models';

describe('guarantee codec', () => {
  it('round trips guarantee claims', () => {
    const claims: PaymentGuaranteeClaims = {
      domain: new Uint8Array(32),
      userAddress: '0x0000000000000000000000000000000000000001',
      recipientAddress: '0x0000000000000000000000000000000000000002',
      tabId: 1n,
      reqId: 2n,
      amount: 3n,
      totalAmount: 4n,
      assetAddress: '0x0000000000000000000000000000000000000000',
      timestamp: 123456,
      version: 1,
    };
    const encoded = encodeGuaranteeClaims(claims);
    const decoded = decodeGuaranteeClaims(encoded);
    expect(decoded.userAddress).toBe(claims.userAddress);
    expect(decoded.recipientAddress).toBe(claims.recipientAddress);
    expect(decoded.tabId).toBe(claims.tabId);
    expect(decoded.amount).toBe(claims.amount);
  });
});
