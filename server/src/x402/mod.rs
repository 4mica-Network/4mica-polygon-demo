use base64::{Engine, prelude::BASE64_STANDARD};
use log::{debug, info};
use sdk_4mica::{U256, x402::PaymentRequirements};
use serde_json::{Value, json};

mod config;
mod facilitator;
mod fourmica;
mod model;
mod native;

pub use config::X402Config;
pub use facilitator::{FacilitatorClient, FacilitatorClientError};
pub use model::{PaymentRequirementsV2, PaymentRequiredV2, X402ResourceInfo};

use crate::{
    error::PaymentError,
    x402::model::{
        FacilitatorSettleParams, FacilitatorSettleParamsV2, FacilitatorTabRequestParams,
        FacilitatorTabResponse,
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
            extra: Some(json!({
                "tabEndpoint": tab_endpoint,
            })),
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
            extra: None,
        },
    ]
}

pub fn build_accepted_payment_requirements_v2(
    config: &X402Config,
    amount: U256,
    tab_endpoint: String,
) -> Vec<PaymentRequirementsV2> {
    let amount = amount.to_string();
    vec![PaymentRequirementsV2 {
        scheme: config.scheme_4mica.clone(),
        network: config.network_v2.clone(),
        amount,
        asset: config.asset.clone(),
        pay_to: config.pay_to.clone(),
        max_timeout_seconds: Some(3600),
        extra: Some(json!({
            "tabEndpoint": tab_endpoint,
        })),
    }]
}

pub fn build_payment_required_v2(
    accepts: Vec<PaymentRequirementsV2>,
    resource: X402ResourceInfo,
) -> PaymentRequiredV2 {
    PaymentRequiredV2 {
        x402_version: 2,
        error: None,
        resource,
        accepts,
        extensions: None,
    }
}

fn find_matching_payment_requirements<'a>(
    scheme: &str,
    network: &str,
    accepted: &'a [PaymentRequirements],
) -> Result<&'a PaymentRequirements, PaymentError> {
    accepted
        .iter()
        .find(|req| req.scheme == scheme && req.network == network)
        .ok_or_else(|| PaymentError::NoMatchingRequirements {
            scheme: scheme.to_string(),
            network: network.to_string(),
        })
}

fn find_matching_payment_requirements_v2<'a>(
    scheme: &str,
    network: &str,
    accepted: &'a [PaymentRequirementsV2],
) -> Result<&'a PaymentRequirementsV2, PaymentError> {
    accepted
        .iter()
        .find(|req| req.scheme == scheme && req.network == network)
        .ok_or_else(|| PaymentError::NoMatchingRequirements {
            scheme: scheme.to_string(),
            network: network.to_string(),
        })
}

fn decode_payment_header(payment_header: &str) -> Result<Value, PaymentError> {
    let bytes = BASE64_STANDARD.decode(payment_header)?;
    let envelope = serde_json::from_slice(&bytes)?;
    Ok(envelope)
}

fn encode_payment_header(envelope: &Value) -> Result<String, PaymentError> {
    let bytes = serde_json::to_vec(envelope)?;
    Ok(BASE64_STANDARD.encode(bytes))
}

fn normalize_req_id(envelope: &mut Value) -> bool {
    let Value::Object(envelope_map) = envelope else {
        return false;
    };
    let Some(Value::Object(payload)) = envelope_map.get_mut("payload") else {
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

fn extract_claim_value(envelope: &Value, key: &str) -> Option<String> {
    let Value::Object(envelope_map) = envelope else {
        return None;
    };
    let Some(Value::Object(payload_map)) = envelope_map.get("payload") else {
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

fn extract_x402_version(envelope: &Value) -> u64 {
    envelope
        .get("x402Version")
        .and_then(|val| val.as_u64())
        .unwrap_or(1)
}

fn extract_scheme_network(envelope: &Value, version: u64) -> Result<(String, String), PaymentError> {
    if version == 2 {
        let accepted = envelope
            .get("accepted")
            .ok_or_else(|| PaymentError::Other("missing accepted in payment payload".into()))?;
        let scheme = accepted
            .get("scheme")
            .and_then(|val| val.as_str())
            .ok_or_else(|| PaymentError::Other("missing scheme in accepted requirements".into()))?;
        let network = accepted
            .get("network")
            .and_then(|val| val.as_str())
            .ok_or_else(|| PaymentError::Other("missing network in accepted requirements".into()))?;
        return Ok((scheme.to_string(), network.to_string()));
    }

    let scheme = envelope
        .get("scheme")
        .and_then(|val| val.as_str())
        .ok_or_else(|| PaymentError::Other("missing scheme in payment payload".into()))?;
    let network = envelope
        .get("network")
        .and_then(|val| val.as_str())
        .ok_or_else(|| PaymentError::Other("missing network in payment payload".into()))?;
    Ok((scheme.to_string(), network.to_string()))
}

pub async fn settle_payment(
    payment_header: &str,
    accepted_payment_requirements: &[PaymentRequirements],
    accepted_payment_requirements_v2: &[PaymentRequirementsV2],
    facilitator: &FacilitatorClient,
    config: &X402Config,
) -> Result<(), PaymentError> {
    let mut envelope = decode_payment_header(payment_header)?;
    let mut normalized_header = payment_header.to_string();
    if normalize_req_id(&mut envelope) {
        normalized_header = encode_payment_header(&envelope)?;
        debug!("Normalized x402 payment header: copied reqId -> req_id");
    }
    if let Ok(payload_json) = serde_json::to_string(&envelope.get("payload").cloned().unwrap_or(Value::Null)) {
        debug!("Decoded x402 envelope payload={}", payload_json);
    }
    let req_id = extract_claim_value(&envelope, "req_id");
    let req_id_alt = extract_claim_value(&envelope, "reqId");
    let tab_id = extract_claim_value(&envelope, "tab_id")
        .or_else(|| extract_claim_value(&envelope, "tabId"));
    debug!(
        "Decoded x402 claims: tab_id={:?} req_id={:?} reqId={:?}",
        tab_id, req_id, req_id_alt
    );
    let x402_version = extract_x402_version(&envelope);
    let (scheme, network) = extract_scheme_network(&envelope, x402_version)?;
    debug!(
        "Decoded x402 envelope: version={}, scheme={}, network={}",
        x402_version, scheme, network
    );

    if x402_version == 2 {
        let selected_requirement =
            find_matching_payment_requirements_v2(&scheme, &network, accepted_payment_requirements_v2)?;
        info!(
            "Matched v2 payment requirements: scheme={}, network={}, pay_to={}, asset={}, amount={}",
            selected_requirement.scheme,
            selected_requirement.network,
            selected_requirement.pay_to,
            selected_requirement.asset,
            selected_requirement.amount
        );

        info!(
            "Calling facilitator /settle for scheme={} network={}",
            scheme, network
        );
        debug!(
            "Sending payment header to facilitator: bytes={} normalized={}",
            normalized_header.len(),
            normalized_header != payment_header
        );
        let payment_payload = serde_json::to_value(&envelope)?;
        let settle_response = facilitator
            .settle_v2(&FacilitatorSettleParamsV2 {
                x402_version: 2,
                payment_header: &normalized_header,
                payment_payload: Some(payment_payload),
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

        if scheme.to_lowercase().contains("4mica") {
            fourmica::log_fourmica_payment_info(&envelope, config).await;
        }

        return Ok(());
    }

    let selected_requirement =
        find_matching_payment_requirements(&scheme, &network, accepted_payment_requirements)?;
    info!(
        "Matched payment requirements: scheme={}, network={}, pay_to={}, asset={}, max_amount_required={}",
        selected_requirement.scheme,
        selected_requirement.network,
        selected_requirement.pay_to,
        selected_requirement.asset,
        selected_requirement.max_amount_required
    );

    let scheme_lower = scheme.to_lowercase();
    if scheme_lower == "exact" && native::is_native_asset(&selected_requirement.asset) {
        return native::verify_native_payment(&envelope, selected_requirement, &config.rpc_url)
            .await;
    }

    info!(
        "Calling facilitator /settle for scheme={} network={}",
        scheme, network
    );
    debug!(
        "Sending payment header to facilitator: bytes={} normalized={}",
        normalized_header.len(),
        normalized_header != payment_header
    );
    let payment_payload = serde_json::to_value(&envelope)?;
    let settle_response = facilitator
        .settle(&FacilitatorSettleParams {
            x402_version: X402_VERSION,
            payment_header: &normalized_header,
            payment_payload: Some(payment_payload),
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

    if scheme_lower.contains("4mica") {
        fourmica::log_fourmica_payment_info(&envelope, config).await;
    }

    Ok(())
}
