use crate::http::{model::TabRequestParams, x402};
use axum::{
    Json, Router,
    extract::{Path, Query, State},
    http::{HeaderMap, HeaderName, HeaderValue, StatusCode, Uri},
    response::{IntoResponse, Response},
    routing::{get, post},
};
use log::error;
use reqwest::Client;
use sdk_4mica::U256;
use serde::Deserialize;
use serde_json::Value;
use server::x402::FacilitatorClient;
use std::sync::Arc;
use tower_http::cors::CorsLayer;

use super::config::Config;

#[derive(Clone)]
pub struct AppState {
    pub config: Arc<Config>,
    pub facilitator: Arc<FacilitatorClient>,
}

#[derive(Debug, Deserialize)]
struct RemoteStreamQuery {
    url: String,
}

pub fn build_router(state: AppState) -> Router {
    Router::new()
        .route("/tab", post(handle_tab))
        .route("/rpc", post(handle_rpc_proxy))
        .route("/stream/remote", get(handle_remote_stream))
        .route("/stream/{filename}", get(handle_stream))
        .with_state(state)
        .layer(
            CorsLayer::permissive().expose_headers([
                HeaderName::from_static("payment-required"),
                HeaderName::from_static("payment-response"),
                HeaderName::from_static("x-payment"),
            ]),
        )
}

async fn handle_tab(State(state): State<AppState>, Json(body): Json<TabRequestParams>) -> Response {
    let tab = server::x402::request_tab(
        body.user_address,
        body.payment_requirements.into_payment_requirements(),
        &state.facilitator,
    )
    .await;
    match tab {
        Ok(tab) => (StatusCode::OK, Json(tab)).into_response(),
        Err(e) => {
            error!("Failed to request tab: {}", e);
            (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response()
        }
    }
}

async fn handle_stream(
    State(state): State<AppState>,
    Path(filename): Path<String>,
    uri: Uri,
    headers: HeaderMap,
) -> Response {
    // Verify the file path before charging for the file
    let file_path = match server::io::verify_file(&state.config.file_directory, &filename) {
        Ok(file_path) => file_path,
        Err(e) => {
            error!("Failed to verify file path: {}", e);
            return (StatusCode::BAD_REQUEST, e.to_string()).into_response();
        }
    };

    let resource = match state.config.server_advertised_url.join(&uri.to_string()) {
        Ok(resource) => resource,
        Err(e) => {
            error!("Failed to construct resource URL: {}", e);
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to construct resource URL",
            )
                .into_response();
        }
    };
    // We don't want to charge for playlist files
    let is_playlist = filename.ends_with(".m3u8");
    if state.config.x402.enabled
        && !is_playlist
        && let Err(err) =
            x402::handle_x402_paywall(&state, U256::from(100), resource.to_string(), headers).await
    {
        return err;
    }

    match server::io::stream_file(&file_path).await {
        Ok(body) => {
            let mut resp = (StatusCode::OK, body).into_response();
            if is_playlist {
                resp.headers_mut().insert(
                    axum::http::header::CONTENT_TYPE,
                    HeaderValue::from_static("application/vnd.apple.mpegurl"),
                );
            } else if filename.ends_with(".ts") {
                resp.headers_mut().insert(
                    axum::http::header::CONTENT_TYPE,
                    HeaderValue::from_static("video/mp2t"),
                );
            }
            resp
        }
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

async fn handle_remote_stream(
    State(state): State<AppState>,
    Query(query): Query<RemoteStreamQuery>,
    uri: Uri,
    headers: HeaderMap,
) -> Response {
    let url = query.url;

    let resource = match state.config.server_advertised_url.join(&uri.to_string()) {
        Ok(resource) => resource,
        Err(e) => {
            error!("Failed to construct resource URL: {}", e);
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to construct resource URL",
            )
                .into_response();
        }
    };
    // We don't want to charge for playlist files
    let is_playlist = url.ends_with(".m3u8");
    if state.config.x402.enabled
        && !is_playlist
        && let Err(err) =
            x402::handle_x402_paywall(&state, U256::from(100), resource.to_string(), headers).await
    {
        return err;
    }

    match server::io::stream_remote_file(&url).await {
        Ok(remote) => {
            let mut resp = (StatusCode::OK, remote.body).into_response();
            if let Some(ct) = remote.content_type {
                resp.headers_mut()
                    .insert(axum::http::header::CONTENT_TYPE, ct);
            } else if is_playlist {
                resp.headers_mut().insert(
                    axum::http::header::CONTENT_TYPE,
                    HeaderValue::from_static("application/vnd.apple.mpegurl"),
                );
            }
            resp
        }
        Err(e) => {
            error!("Failed to stream remote file: {}, Error: {}", url, e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to fetch remote file",
            )
                .into_response()
        }
    }
}

async fn handle_rpc_proxy(State(state): State<AppState>, Json(body): Json<Value>) -> Response {
    let client = Client::new();
    let upstream = state.config.x402.rpc_url.clone();

    match client.post(upstream).json(&body).send().await {
        Ok(resp) => {
            let status = resp.status();
            let text = resp
                .text()
                .await
                .unwrap_or_else(|_| "Upstream RPC error".to_string());
            let mut response = (status, text).into_response();
            response.headers_mut().insert(
                axum::http::header::CONTENT_TYPE,
                HeaderValue::from_static("application/json"),
            );
            response
        }
        Err(e) => {
            error!("RPC proxy request failed: {}", e);
            (
                StatusCode::BAD_GATEWAY,
                format!("RPC proxy request failed: {e}"),
            )
                .into_response()
        }
    }
}
