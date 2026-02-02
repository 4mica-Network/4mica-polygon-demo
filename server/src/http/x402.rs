use axum::{
    Json,
    http::{HeaderMap, HeaderValue},
    response::{IntoResponse, Response},
};
use base64::{Engine, prelude::BASE64_STANDARD};
use http::StatusCode;
use log::{error, info, warn};
use sdk_4mica::U256;

use crate::http::{model::PaymentRequiredResponse, router::AppState};

fn encode_payment_required_header(required: &server::x402::PaymentRequiredV2) -> Option<HeaderValue> {
    let json = serde_json::to_vec(required).ok()?;
    let encoded = BASE64_STANDARD.encode(json);
    HeaderValue::from_str(&encoded).ok()
}

fn build_payment_required_response(
    payment_requirements: Vec<sdk_4mica::x402::PaymentRequirements>,
    payment_required_v2: Option<&server::x402::PaymentRequiredV2>,
    error: Option<String>,
) -> Response {
    let error_clone = error.clone();
    let mut resp = (
        StatusCode::PAYMENT_REQUIRED,
        Json(PaymentRequiredResponse {
            x402_version: server::x402::X402_VERSION,
            accepts: payment_requirements,
            error,
        }),
    )
        .into_response();
    if let Some(payment_required_v2) = payment_required_v2 {
        let mut payment_required_v2 = payment_required_v2.clone();
        payment_required_v2.error = error_clone;
        if let Some(header) = encode_payment_required_header(&payment_required_v2) {
            resp.headers_mut()
                .insert("payment-required", header);
        }
    }
    resp
}

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
    let payment_requirements_v2 = server::x402::build_accepted_payment_requirements_v2(
        &state.config.x402,
        price,
        tab_endpoint.to_string(),
    );
    let description = Some(format!("Access to resource: {}", resource));
    let payment_required_v2 = server::x402::build_payment_required_v2(
        payment_requirements_v2.clone(),
        server::x402::X402ResourceInfo {
            url: resource.clone(),
            description,
            mime_type: Some("video/mp2t".to_string()),
        },
    );

    let payment_header = headers
        .get("payment-signature")
        .or_else(|| headers.get("PAYMENT-SIGNATURE"))
        .or_else(|| headers.get("x-payment"));

    let Some(payment_header) = payment_header else {
        warn!("x402 payment header missing; returning 402 with requirements");
        return Err(build_payment_required_response(
            payment_requirements,
            Some(&payment_required_v2),
            None,
        ));
    };
    let payment_header = match payment_header.to_str() {
        Ok(s) => s.to_string(),
        Err(e) => {
            error!("Invalid payment header: {}", e);
            return Err(build_payment_required_response(
                payment_requirements,
                Some(&payment_required_v2),
                Some("Invalid payment header".to_string()),
            ));
        }
    };

    if let Err(e) = server::x402::settle_payment(
        &payment_header,
        &payment_requirements,
        &payment_requirements_v2,
        &state.facilitator,
        &state.config.x402,
    )
    .await
    {
        error!("Payment settlement failed: {}", e);
        return Err(build_payment_required_response(
            payment_requirements,
            Some(&payment_required_v2),
            Some(format!("Payment settlement failed: {}", e)),
        ));
    }

    info!(
        "x402 payment settled successfully for resource={}",
        resource
    );

    Ok(())
}
