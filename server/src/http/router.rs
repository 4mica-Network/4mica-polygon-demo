use axum::{
    Json, Router,
    extract::{FromRef, Path, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::{get, post},
};
use log::error;
use rust_sdk_4mica::{U256, x402::TabRequestParams};
use server::x402::FacilitatorClient;
use std::sync::Arc;

use crate::http::model::PaymentRequiredResponse;

use super::config::Config;

#[derive(Clone)]
pub struct AppState {
    pub config: Arc<Config>,
    pub facilitator: Arc<FacilitatorClient>,
}

impl FromRef<AppState> for Arc<Config> {
    fn from_ref(state: &AppState) -> Self {
        state.config.clone()
    }
}

impl FromRef<AppState> for Arc<FacilitatorClient> {
    fn from_ref(state: &AppState) -> Self {
        state.facilitator.clone()
    }
}

pub fn build_router(state: AppState) -> Router {
    Router::new()
        .route("/tab", post(handle_tab))
        .route("/stream/:filename", get(handle_stream))
        .with_state(state)
}

async fn handle_tab(Json(_body): Json<TabRequestParams>) -> impl IntoResponse {
    StatusCode::OK
}

async fn handle_stream(
    State(config): State<Arc<Config>>,
    State(facilitator): State<Arc<FacilitatorClient>>,
    Path(filename): Path<String>,
    headers: HeaderMap,
) -> Response {
    let tab_endpoint = match config.server_advertised_url.join("/tab") {
        Ok(tab_endpoint) => tab_endpoint,
        Err(e) => {
            error!("Failed to construct tab endpoint: {}", e);
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to construct tab endpoint",
            )
                .into_response();
        }
    };

    let payment_requirements = server::x402::build_payment_requirement(
        &config.x402,
        U256::from(100),
        tab_endpoint.to_string(),
        Some(filename.clone()),
    );

    let Some(payment_header) = headers.get("x-payment") else {
        return (
            StatusCode::PAYMENT_REQUIRED,
            Json(PaymentRequiredResponse {
                x402_version: 1,
                accepts: payment_requirements,
                error: None,
            }),
        )
            .into_response();
    };
    let payment_header = match payment_header.to_str() {
        Ok(s) => s.to_string(),
        Err(e) => {
            error!("Invalid x-payment header: {}", e);
            return (
                StatusCode::PAYMENT_REQUIRED,
                Json(PaymentRequiredResponse {
                    x402_version: 1,
                    accepts: payment_requirements,
                    error: Some("Invalid x-payment header".to_string()),
                }),
            )
                .into_response();
        }
    };

    if let Err(e) = server::x402::settle_payment(
        payment_header,
        payment_requirements[0].clone(),
        &facilitator,
    )
    .await
    {
        error!("Payment settlement failed: {}", e);
        return (
            StatusCode::PAYMENT_REQUIRED,
            Json(PaymentRequiredResponse {
                x402_version: 1,
                accepts: payment_requirements,
                error: Some(format!("Payment settlement failed: {}", e)),
            }),
        )
            .into_response();
    }

    match server::stream_file(&config.file_directory, &filename).await {
        Ok(body) => (StatusCode::OK, body).into_response(),
        Err(e) => {
            use server::FileStreamError;

            let (status, message) = match e {
                FileStreamError::NotFound(_) => (StatusCode::NOT_FOUND, "File not found"),
                FileStreamError::NotAFile(_) => (StatusCode::BAD_REQUEST, "Not a file"),
                FileStreamError::AccessDenied => (StatusCode::FORBIDDEN, "Access denied"),
                FileStreamError::IoError(_) => {
                    error!("Failed to stream file: {}", e);
                    (StatusCode::INTERNAL_SERVER_ERROR, "Failed to read file")
                }
            };

            (status, message).into_response()
        }
    }
}
