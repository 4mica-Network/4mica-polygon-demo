use envconfig::Envconfig;
use url::Url;

#[derive(Envconfig, Debug, Clone)]
pub struct X402Config {
    #[envconfig(from = "X402_ENABLED", default = "true")]
    pub enabled: bool,

    #[envconfig(from = "X402_SCHEME_4MICA", default = "4mica-credit")]
    pub scheme_4mica: String,

    #[envconfig(from = "X402_NETWORK", default = "polygon-amoy")]
    pub network: String,

    #[envconfig(from = "X402_NETWORK_V2", default = "eip155:80002")]
    pub network_v2: String,

    #[envconfig(from = "X402_PAY_TO")]
    pub pay_to: String,

    #[envconfig(from = "X402_RPC_URL", default = "https://rpc.ankr.com/polygon_amoy")]
    pub rpc_url: String,

    #[envconfig(
        from = "X402_ASSET",
        // USDC on Polygon Amoy
        default = "0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582"
    )]
    pub asset: String,

    #[envconfig(from = "X402_FACILITATOR_URL", default = "https://x402.4mica.xyz/")]
    pub facilitator_url: Url,
}
