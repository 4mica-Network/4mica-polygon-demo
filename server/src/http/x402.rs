use axum::{
    Json,
    http::HeaderMap,
    response::{IntoResponse, Response},
};
use http::StatusCode;
use log::{error, info, warn};
use rust_sdk_4mica::U256;

use crate::http::{model::PaymentRequiredResponse, router::AppState};

pub async fn handle_x402_paywall(
    state: &AppState,
    price: U256,
    resource: String,
    headers: HeaderMap,
) -> Result<(), Response> {
    info!(
        "x402 paywall check: resource={}, price_wei={:#x}",
        resource, price
    );
    let tab_endpoint = match state.config.server_advertised_url.join("/tab") {
        Ok(tab_endpoint) => tab_endpoint,
        Err(e) => {
            error!("Failed to construct tab endpoint: {}", e);
            return Err((
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to construct tab endpoint",
            )
                .into_response());
        }
    };

    let payment_requirements = server::x402::build_accepted_payment_requirements(
        &state.config.x402,
        price,
        tab_endpoint.to_string(),
        Some(resource.clone()),
    );

    let Some(payment_header) = headers.get("x-payment") else {
        warn!("x402 payment header missing; returning 402 with requirements");
        return Err((
            StatusCode::PAYMENT_REQUIRED,
            Json(PaymentRequiredResponse {
                x402_version: server::x402::X402_VERSION,
                accepts: payment_requirements,
                error: None,
            }),
        )
            .into_response());
    };
    let payment_header = match payment_header.to_str() {
        Ok(s) => s.to_string(),
        Err(e) => {
            error!("Invalid x-payment header: {}", e);
            return Err((
                StatusCode::PAYMENT_REQUIRED,
                Json(PaymentRequiredResponse {
                    x402_version: server::x402::X402_VERSION,
                    accepts: payment_requirements,
                    error: Some("Invalid x-payment header".to_string()),
                }),
            )
                .into_response());
        }
    };

    if let Err(e) = server::x402::settle_payment(
        &payment_header,
        &payment_requirements,
        &state.facilitator,
        &state.config.x402,
    )
    .await
    {
        error!("Payment settlement failed: {}", e);
        return Err((
            StatusCode::PAYMENT_REQUIRED,
            Json(PaymentRequiredResponse {
                x402_version: server::x402::X402_VERSION,
                accepts: payment_requirements,
                error: Some(format!("Payment settlement failed: {}", e)),
            }),
        )
            .into_response());
    }

    info!(
        "x402 payment settled successfully for resource={}",
        resource
    );

    Ok(())
}
