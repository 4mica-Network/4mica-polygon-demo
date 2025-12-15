import { getBytes } from 'ethers';
import { VerificationError } from './errors';

type BlsField = { value?: string | number | bigint } | string | number | bigint;

type BlsModule = {
  bls12_381: {
    G2: {
      ProjectivePoint: {
        fromHex(bytes: Uint8Array): {
          toAffine(): {
            x: { c: readonly [BlsField, BlsField] };
            y: { c: readonly [BlsField, BlsField] };
          };
        };
      };
    };
  };
};

function splitFp(value: bigint): [Uint8Array, Uint8Array] {
  const be48 = value.toString(16).padStart(96, '0');
  const bytes = getBytes(`0x${be48}`);
  const hi = new Uint8Array(32);
  hi.set(bytes.slice(0, 16), 16);
  const lo = bytes.slice(16);
  return [hi, lo];
}

/**
 * Expand a compressed G2 signature into the tuple expected by the contract.
 * This mirrors the Python helper and requires the optional `@noble/curves` dependency.
 */
export function signatureToWords(signatureHex: string): Uint8Array[] {
  let curves: BlsModule;
  try {
    // Lazy require to keep the dependency optional.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    curves = require('@noble/curves/bls12-381') as BlsModule;
  } catch {
    throw new VerificationError(
      'BLS decoding requires @noble/curves; install it to enable remuneration'
    );
  }

  const toBigint = (field: BlsField): bigint => {
    if (typeof field === 'bigint' || typeof field === 'number' || typeof field === 'string') {
      return BigInt(field);
    }
    if (field && typeof field === 'object' && 'value' in field && field.value !== undefined) {
      const value = field.value;
      if (typeof value === 'bigint' || typeof value === 'number' || typeof value === 'string') {
        return BigInt(value);
      }
    }
    throw new VerificationError('invalid BLS field element');
  };

  try {
    const sigBytes = getBytes(signatureHex);
    const point = curves.bls12_381.G2.ProjectivePoint.fromHex(sigBytes);
    const affine = point.toAffine();
    const [x0, x1] = affine.x.c;
    const [y0, y1] = affine.y.c;
    const coords = [x0, x1, y0, y1].map((fp) => toBigint(fp));
    const words: Uint8Array[] = [];
    coords.forEach((coord) => {
      const [hi, lo] = splitFp(coord);
      words.push(hi, lo);
    });
    return words;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    throw new VerificationError(`invalid BLS signature: ${message}`);
  }
}
