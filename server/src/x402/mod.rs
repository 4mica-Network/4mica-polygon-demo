use base64::{Engine, prelude::BASE64_STANDARD};
use log::{debug, info};
use rust_sdk_4mica::{U256, x402::PaymentRequirements};
use serde_json::json;

mod config;
mod facilitator;
mod model;

pub use config::X402Config;
pub use facilitator::{FacilitatorClient, FacilitatorClientError};

use crate::{
    error::PaymentError,
    x402::model::{
        FacilitatorSettleParams, FacilitatorTabRequestParams, FacilitatorTabResponse,
        PaymentEnvelope,
    },
};

pub const X402_VERSION: u64 = 1;

pub async fn request_tab(
    user_address: String,
    payment_requirements: PaymentRequirements,
    facilitator: &FacilitatorClient,
) -> Result<FacilitatorTabResponse, PaymentError> {
    log::info!(
        "Requesting tab via facilitator for user={} pay_to={} asset={}",
        user_address,
        payment_requirements.pay_to,
        payment_requirements.asset
    );
    let tab_request = FacilitatorTabRequestParams {
        user_address,
        recipient_address: payment_requirements.pay_to,
        erc20_token: payment_requirements.asset,
        ttl_seconds: Some(86400), // 1 day TTL
    };

    facilitator
        .request_tab(&tab_request)
        .await
        .map_err(PaymentError::from)
}

pub fn build_accepted_payment_requirements(
    config: &X402Config,
    max_amount_required: U256,
    tab_endpoint: String,
    resource: Option<String>,
) -> Vec<PaymentRequirements> {
    let max_amount_required = format!("{:#x}", max_amount_required);
    vec![
        PaymentRequirements {
            scheme: config.scheme_4mica.clone(),
            network: config.network.clone(),
            max_amount_required: max_amount_required.clone(),
            resource: resource.clone(),
            description: None,
            mime_type: None,
            output_schema: None,
            pay_to: config.pay_to.clone(),
            max_timeout_seconds: None,
            asset: config.asset.clone(),
            extra: json!({
                "tabEndpoint": tab_endpoint,
            }),
        },
        PaymentRequirements {
            scheme: "exact".to_string(),
            network: config.network.clone(),
            max_amount_required,
            resource,
            description: None,
            mime_type: None,
            output_schema: None,
            pay_to: config.pay_to.clone(),
            max_timeout_seconds: None,
            asset: config.asset.clone(),
            extra: json!({}),
        },
    ]
}

fn find_matching_payment_requirements<'a>(
    envelope: &PaymentEnvelope,
    accepted: &'a [PaymentRequirements],
) -> Result<&'a PaymentRequirements, PaymentError> {
    accepted
        .iter()
        .find(|req| {
            envelope.x402_version == X402_VERSION
                && req.scheme == envelope.scheme
                && req.network == envelope.network
        })
        .ok_or_else(|| PaymentError::NoMatchingRequirements {
            scheme: envelope.scheme.clone(),
            network: envelope.network.clone(),
        })
}

fn decode_payment_header(payment_header: &str) -> Result<PaymentEnvelope, PaymentError> {
    let bytes = BASE64_STANDARD.decode(payment_header)?;
    let envelope = serde_json::from_slice(&bytes)?;
    Ok(envelope)
}

pub async fn settle_payment(
    payment_header: &str,
    accepted_payment_requirements: &[PaymentRequirements],
    facilitator: &FacilitatorClient,
) -> Result<(), PaymentError> {
    let envelope = decode_payment_header(payment_header)?;
    debug!(
        "Decoded x402 envelope: version={}, scheme={}, network={}",
        envelope.x402_version, envelope.scheme, envelope.network
    );
    let selected_requirement =
        find_matching_payment_requirements(&envelope, accepted_payment_requirements)?;
    info!(
        "Matched payment requirements: scheme={}, network={}, pay_to={}, asset={}, max_amount_required={}",
        selected_requirement.scheme,
        selected_requirement.network,
        selected_requirement.pay_to,
        selected_requirement.asset,
        selected_requirement.max_amount_required
    );

    info!(
        "Calling facilitator /settle for scheme={} network={}",
        envelope.scheme, envelope.network
    );
    let settle_response = facilitator
        .settle(&FacilitatorSettleParams {
            x402_version: X402_VERSION,
            payment_header,
            payment_requirements: selected_requirement,
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
    } else {
        info!("Settled payment header successfully (no certificate returned)");
    }

    Ok(())
}
