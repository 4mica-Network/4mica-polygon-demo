mod http;

use env_logger::Env;
use http::Config;
use log::{error, info};
use server::x402::FacilitatorClient;
use std::sync::Arc;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    dotenv::dotenv().ok();

    let config = match Config::from_env() {
        Ok(config) => Arc::new(config),
        Err(e) => {
            error!("Failed to load configuration: {}", e);
            std::process::exit(1);
        }
    };

    env_logger::Builder::from_env(Env::default().default_filter_or(config.log_level.as_str()))
        .init();

    let facilitator = FacilitatorClient::try_new(config.x402.facilitator_url.clone())?;
    let state = http::router::AppState {
        config: config.clone(),
        facilitator: Arc::new(facilitator),
    };
    let app = http::router::build_router(state);

    let addr = format!("{}:{}", config.server_host, config.server_port);
    let listener = match tokio::net::TcpListener::bind(&addr).await {
        Ok(listener) => listener,
        Err(e) => {
            error!("Failed to bind to {}: {}", addr, e);
            std::process::exit(1);
        }
    };

    info!("Server listening on {}", addr);
    info!("Serving files from: {}", config.file_directory);

    if let Err(e) = axum::serve(listener, app).await {
        error!("Server error: {}", e);
        std::process::exit(1);
    }

    Ok(())
}
