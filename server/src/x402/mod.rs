use base64::{Engine, prelude::BASE64_STANDARD};
use log::{debug, info};
use rust_sdk_4mica::{U256, x402::PaymentRequirements};
use serde_json::{Value, json};

mod config;
mod facilitator;
mod fourmica;
mod model;
mod native;

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
    let description = resource
        .as_ref()
        .map(|r| format!("Access to resource: {}", r));
    vec![
        PaymentRequirements {
            scheme: config.scheme_4mica.clone(),
            network: config.network.clone(),
            max_amount_required: max_amount_required.clone(),
            resource: resource.clone(),
            description: description.clone(),
            mime_type: Some("video/mp2t".to_string()),
            output_schema: None,
            pay_to: config.pay_to.clone(),
            max_timeout_seconds: Some(3600),
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
            description,
            mime_type: Some("video/mp2t".to_string()),
            output_schema: None,
            pay_to: config.pay_to.clone(),
            max_timeout_seconds: Some(3600),
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

fn encode_payment_header(envelope: &PaymentEnvelope) -> Result<String, PaymentError> {
    let bytes = serde_json::to_vec(envelope)?;
    Ok(BASE64_STANDARD.encode(bytes))
}

fn normalize_req_id(envelope: &mut PaymentEnvelope) -> bool {
    let Value::Object(payload) = &mut envelope.payload else {
        return false;
    };
    let Some(Value::Object(claims)) = payload.get_mut("claims") else {
        return false;
    };
    if claims.contains_key("req_id") {
        return false;
    }
    let Some(req_id) = claims.get("reqId").cloned() else {
        return false;
    };
    claims.insert("req_id".to_string(), req_id);
    true
}

fn extract_claim_value(payload: &Value, key: &str) -> Option<String> {
    let Value::Object(payload_map) = payload else {
        return None;
    };
    let Some(Value::Object(claims)) = payload_map.get("claims") else {
        return None;
    };
    claims.get(key).map(|val| match val {
        Value::String(s) => s.clone(),
        Value::Number(n) => n.to_string(),
        _ => format!("{val}"),
    })
}

pub async fn settle_payment(
    payment_header: &str,
    accepted_payment_requirements: &[PaymentRequirements],
    facilitator: &FacilitatorClient,
    config: &X402Config,
) -> Result<(), PaymentError> {
    let mut envelope = decode_payment_header(payment_header)?;
    let mut normalized_header = payment_header.to_string();
    if normalize_req_id(&mut envelope) {
        normalized_header = encode_payment_header(&envelope)?;
        debug!("Normalized x402 payment header: copied reqId -> req_id");
    }
    if let Ok(payload_json) = serde_json::to_string(&envelope.payload) {
        debug!("Decoded x402 envelope payload={}", payload_json);
    }
    let req_id = extract_claim_value(&envelope.payload, "req_id");
    let req_id_alt = extract_claim_value(&envelope.payload, "reqId");
    let tab_id = extract_claim_value(&envelope.payload, "tab_id")
        .or_else(|| extract_claim_value(&envelope.payload, "tabId"));
    debug!(
        "Decoded x402 claims: tab_id={:?} req_id={:?} reqId={:?}",
        tab_id, req_id, req_id_alt
    );
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

    let scheme = envelope.scheme.to_lowercase();
    if scheme == "exact" && native::is_native_asset(&selected_requirement.asset) {
        return native::verify_native_payment(&envelope, selected_requirement, &config.rpc_url)
            .await;
    }

    info!(
        "Calling facilitator /settle for scheme={} network={}",
        envelope.scheme, envelope.network
    );
    debug!(
        "Sending payment header to facilitator: bytes={} normalized={}",
        normalized_header.len(),
        normalized_header != payment_header
    );
    let settle_response = facilitator
        .settle(&FacilitatorSettleParams {
            x402_version: X402_VERSION,
            payment_header: &normalized_header,
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
        info!("Settled payment header successfully.");
    }

    if scheme.contains("4mica") {
        fourmica::log_fourmica_payment_info(&envelope, config).await;
    }

    Ok(())
}
