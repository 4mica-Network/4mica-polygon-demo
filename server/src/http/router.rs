use crate::http::x402;
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
    State(state): State<AppState>,
    Path(filename): Path<String>,
    headers: HeaderMap,
) -> Response {
    // Verify the file path before charging for the file
    let file_path = match server::fs::verify_file(&state.config.file_directory, &filename) {
        Ok(file_path) => file_path,
        Err(e) => {
            error!("Failed to verify file path: {}", e);
            return (StatusCode::BAD_REQUEST, e.to_string()).into_response();
        }
    };

    // We don't want to charge for playlist files
    let is_playlist = filename.ends_with(".m3u8");
    if !is_playlist
        && let Err(err) =
            x402::handle_x402_paywall(&state, U256::from(100), filename.clone(), headers).await
    {
        return err;
    }

    match server::stream_file(&file_path).await {
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
