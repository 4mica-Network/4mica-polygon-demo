import { ConfigError } from './errors';
import { ValidationError, normalizeAddress, normalizePrivateKey, validateUrl } from './utils';

export interface Config {
  rpcUrl: string;
  walletPrivateKey: string;
  ethereumHttpRpcUrl?: string;
  contractAddress?: string;
  adminApiKey?: string;
}

export class ConfigBuilder {
  private _rpcUrl: string | undefined = 'https://api.4mica.xyz/';
  private _walletPrivateKey: string | undefined;
  private _ethereumHttpRpcUrl?: string;
  private _contractAddress?: string;
  private _adminApiKey?: string;

  rpcUrl(value: string): ConfigBuilder {
    this._rpcUrl = value;
    return this;
  }

  walletPrivateKey(value: string): ConfigBuilder {
    this._walletPrivateKey = value;
    return this;
  }

  ethereumHttpRpcUrl(value: string): ConfigBuilder {
    this._ethereumHttpRpcUrl = value;
    return this;
  }

  contractAddress(value: string): ConfigBuilder {
    this._contractAddress = value;
    return this;
  }

  adminApiKey(value: string): ConfigBuilder {
    this._adminApiKey = value;
    return this;
  }

  fromEnv(): ConfigBuilder {
    const env = process.env;
    if (env['4MICA_RPC_URL']) this._rpcUrl = env['4MICA_RPC_URL'];
    if (env['4MICA_WALLET_PRIVATE_KEY']) this._walletPrivateKey = env['4MICA_WALLET_PRIVATE_KEY'];
    if (env['4MICA_ETHEREUM_HTTP_RPC_URL'])
      this._ethereumHttpRpcUrl = env['4MICA_ETHEREUM_HTTP_RPC_URL'];
    if (env['4MICA_CONTRACT_ADDRESS']) this._contractAddress = env['4MICA_CONTRACT_ADDRESS'];
    if (env['4MICA_ADMIN_API_KEY']) this._adminApiKey = env['4MICA_ADMIN_API_KEY'];
    return this;
  }

  build(): Config {
    if (!this._walletPrivateKey) {
      throw new ConfigError('missing wallet_private_key');
    }
    if (!this._rpcUrl) {
      throw new ConfigError('missing rpc_url');
    }

    try {
      const rpcUrl = validateUrl(this._rpcUrl);
      const walletPrivateKey = normalizePrivateKey(this._walletPrivateKey);
      const ethereumHttpRpcUrl = this._ethereumHttpRpcUrl
        ? validateUrl(this._ethereumHttpRpcUrl)
        : undefined;
      const contractAddress = this._contractAddress
        ? normalizeAddress(this._contractAddress)
        : undefined;

      return {
        rpcUrl,
        walletPrivateKey,
        ethereumHttpRpcUrl,
        contractAddress,
        adminApiKey: this._adminApiKey,
      };
    } catch (err) {
      if (err instanceof ValidationError) {
        throw new ConfigError(err.message);
      }
      throw err;
    }
  }
}
