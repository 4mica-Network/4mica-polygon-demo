use envconfig::Envconfig;
use server::x402::X402Config;
use url::Url;

#[derive(Envconfig, Clone)]
pub struct Config {
    #[envconfig(from = "LOG_LEVEL", default = "info")]
    pub log_level: log::Level,

    #[envconfig(from = "FILE_DIRECTORY", default = "./data/hls")]
    pub file_directory: String,

    #[envconfig(from = "SERVER_PORT", default = "3000")]
    pub server_port: u16,

    #[envconfig(from = "SERVER_HOST", default = "0.0.0.0")]
    pub server_host: String,

    #[envconfig(from = "SERVER_ADVERTISED_URL", default = "http://localhost:3000")]
    pub server_advertised_url: Url,

    #[envconfig(nested)]
    pub x402: X402Config,
}

impl Config {
    pub fn from_env() -> Result<Self, envconfig::Error> {
        Config::init_from_env()
    }
}
