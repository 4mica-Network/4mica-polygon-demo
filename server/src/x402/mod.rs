use base64::{Engine, prelude::BASE64_STANDARD};
use log::info;
use rust_sdk_4mica::{
    U256,
    x402::{PaymentRequirements, X402PaymentEnvelope},
};
use serde_json::json;

mod config;
mod facilitator;
mod model;

pub use config::X402Config;
pub use facilitator::{FacilitatorClient, FacilitatorClientError};

use crate::{error::PaymentError, x402::model::FacilitatorSettleParams};

pub fn build_payment_requirement(
    config: &X402Config,
    max_amount_required: U256,
    tab_endpoint: String,
    resource: Option<String>,
) -> Vec<PaymentRequirements> {
    vec![PaymentRequirements {
        scheme: config.scheme.clone(),
        network: config.network.clone(),
        max_amount_required: format!("{:#x}", max_amount_required),
        resource,
        description: None,
        mime_type: None,
        output_schema: None,
        pay_to: config.pay_to.clone(),
        max_timeout_seconds: None,
        asset: config.asset.clone(),
        extra: json!({
            "tabEndpoint": tab_endpoint,
        }),
    }]
}

fn decode_payment_header(payment_header: &str) -> Result<X402PaymentEnvelope, PaymentError> {
    let bytes = BASE64_STANDARD.decode(payment_header)?;
    let envelope = serde_json::from_slice(&bytes)?;
    Ok(envelope)
}

pub async fn settle_payment(
    payment_header: String,
    payment_requirements: PaymentRequirements,
    facilitator: &FacilitatorClient,
) -> Result<(), PaymentError> {
    let envelope = decode_payment_header(&payment_header)?;

    let settle_response = facilitator
        .settle(&FacilitatorSettleParams {
            x402_version: envelope.x402_version,
            payment_header: payment_header,
            payment_requirements: payment_requirements,
        })
        .await?;

    if !settle_response.success {
        return Err(PaymentError::SettlementFailed(
            settle_response.error.unwrap_or_default(),
        ));
    }

    if let Some(certificate) = settle_response.certificate {
        info!(
            "Settled payment header successfully, Certificate: {:?}",
            certificate
        );
    }

    Ok(())
}
