import { describe, expect, it } from 'vitest';
import { PaymentGuaranteeRequestClaims, SigningScheme } from '../src/models';
import { CorePublicParameters, PaymentSigner } from '../src/signing';
import { SigningError } from '../src/errors';

function buildParams(): CorePublicParameters {
  return new CorePublicParameters(
    new Uint8Array(),
    '0x0000000000000000000000000000000000000000',
    'https://example.com',
    '4Mica',
    '1',
    1
  );
}

describe('PaymentSigner', () => {
  it('rejects address mismatch', async () => {
    const signer = new PaymentSigner('11'.repeat(32));
    const claims = PaymentGuaranteeRequestClaims.new(
      '0x0000000000000000000000000000000000000011',
      '0x0000000000000000000000000000000000000002',
      1,
      5,
      1234,
      null
    );
    await expect(signer.signRequest(buildParams(), claims, SigningScheme.EIP712)).rejects.toThrow(
      SigningError
    );
  });

  it('produces eip712 signature', async () => {
    const privateKey = '0x59c6995e998f97a5a0044976f7be35d5ad91c0cfa55b5cfb20b07a1c60f4c5bc';
    const signer = new PaymentSigner(privateKey);
    const accountAddress = (await signer['wallet'].getAddress()).toLowerCase();
    const claims = PaymentGuaranteeRequestClaims.new(
      accountAddress,
      '0x0000000000000000000000000000000000000002',
      42,
      123,
      999,
      null
    );
    const sig = await signer.signRequest(buildParams(), claims, SigningScheme.EIP712);
    expect(sig.scheme).toBe(SigningScheme.EIP712);
    expect(sig.signature.length).toBe(132);
  });
});
