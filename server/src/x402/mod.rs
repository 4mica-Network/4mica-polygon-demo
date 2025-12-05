use base64::{Engine, prelude::BASE64_STANDARD};
use log::{debug, info};
use rust_sdk_4mica::{U256, x402::PaymentRequirements};
use serde::Deserialize;
use serde_json::{Value, json};
use std::str::FromStr;

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
const ERC20_TRANSFER_TOPIC: &str =
    "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const ZERO_ADDRESS: &str = "0000000000000000000000000000000000000000";

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

#[derive(Debug, Deserialize)]
struct JsonRpcError {
    code: i64,
    message: String,
}

#[derive(Debug, Deserialize)]
struct JsonRpcResponse<T> {
    result: Option<T>,
    error: Option<JsonRpcError>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RpcLog {
    address: String,
    topics: Vec<String>,
    data: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RpcReceipt {
    status: Option<String>,
    #[allow(dead_code)]
    to: Option<String>,
    logs: Vec<RpcLog>,
    block_number: Option<String>,
    #[allow(dead_code)]
    transaction_hash: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RpcTransaction {
    to: Option<String>,
    value: Option<String>,
    #[allow(dead_code)]
    hash: Option<String>,
}

async fn rpc_call<T: for<'de> Deserialize<'de>>(
    client: &reqwest::Client,
    rpc_url: &str,
    method: &str,
    params: Vec<Value>,
) -> Result<T, PaymentError> {
    let body = json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": method,
        "params": params,
    });
    let resp = client
        .post(rpc_url)
        .json(&body)
        .send()
        .await
        .map_err(|e| PaymentError::Onchain(format!("rpc request failed: {e}")))?;
    let status = resp.status();
    let parsed: JsonRpcResponse<T> = resp
        .json()
        .await
        .map_err(|e| PaymentError::Onchain(format!("rpc response parse failed ({status}): {e}")))?;
    if let Some(err) = parsed.error {
        return Err(PaymentError::Onchain(format!(
            "rpc error {}: {}",
            err.code, err.message
        )));
    }
    parsed
        .result
        .ok_or_else(|| PaymentError::Onchain(format!("rpc {method} returned no result")))
}

fn normalize_address(addr: &str) -> String {
    addr.trim_start_matches("0x").to_lowercase()
}

fn topic_to_address(topic: &str) -> Option<String> {
    let clean = topic.trim_start_matches("0x");
    if clean.len() < 40 {
        return None;
    }
    Some(clean[clean.len() - 40..].to_lowercase())
}

fn parse_u256_value(raw: &str) -> Result<U256, PaymentError> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err(PaymentError::Onchain("empty numeric value".into()));
    }
    if let Some(stripped) = trimmed.strip_prefix("0x") {
        U256::from_str_radix(stripped, 16)
            .map_err(|e| PaymentError::Onchain(format!("invalid hex value {trimmed}: {e}")))
    } else {
        U256::from_str(trimmed)
            .map_err(|e| PaymentError::Onchain(format!("invalid decimal value {trimmed}: {e}")))
    }
}

fn is_success_status(status: Option<&str>) -> bool {
    status
        .and_then(|s| parse_u256_value(s).ok())
        .map(|val| val > U256::from(0))
        .unwrap_or(false)
}

fn validate_erc20_transfer(
    receipt: &RpcReceipt,
    asset: &str,
    pay_to: &str,
    required_amount: U256,
) -> Result<(), PaymentError> {
    let transfer = receipt.logs.iter().find(|log| {
        normalize_address(&log.address) == asset
            && log.topics.first().map(|t| t.to_lowercase()) == Some(ERC20_TRANSFER_TOPIC.to_string())
            && log
                .topics
                .get(2)
                .and_then(|topic| topic_to_address(topic))
                .map(|addr| addr == pay_to)
                .unwrap_or(false)
    });

    let Some(log) = transfer else {
        return Err(PaymentError::Onchain(format!(
            "no transfer to {pay_to} found for asset {asset}"
        )));
    };

    let amount = parse_u256_value(&log.data)?;
    if amount < required_amount {
        return Err(PaymentError::Onchain(format!(
            "transfer amount {amount:?} below required {required_amount:?}"
        )));
    }
    Ok(())
}

async fn validate_native_transfer(
    client: &reqwest::Client,
    rpc_url: &str,
    tx_hash: &str,
    pay_to: &str,
    required_amount: U256,
) -> Result<(), PaymentError> {
    let tx: RpcTransaction = rpc_call(
        client,
        rpc_url,
        "eth_getTransactionByHash",
        vec![json!(tx_hash)],
    )
    .await?;
    let to_addr = tx
        .to
        .as_deref()
        .map(normalize_address)
        .ok_or_else(|| PaymentError::Onchain("transaction missing recipient".into()))?;
    if to_addr != pay_to {
        return Err(PaymentError::Onchain(format!(
            "transaction recipient mismatch: expected {pay_to}, got {to_addr}"
        )));
    }
    let value = tx.value.as_deref().unwrap_or("0x0");
    let amount = parse_u256_value(value)?;
    if amount < required_amount {
        return Err(PaymentError::Onchain(format!(
            "transaction value {amount:?} below required {required_amount:?}"
        )));
    }
    Ok(())
}

async fn settle_onchain(
    envelope: &PaymentEnvelope,
    requirements: &PaymentRequirements,
    config: &X402Config,
) -> Result<(), PaymentError> {
    let tx_hash = envelope
        .payload
        .get("txHash")
        .or_else(|| envelope.payload.get("tx_hash"))
        .and_then(|v| v.as_str())
        .ok_or(PaymentError::MissingTxHash)?;
    let rpc_url = config.rpc_url.as_str();
    let client = reqwest::Client::new();

    let receipt: RpcReceipt = rpc_call(
        &client,
        rpc_url,
        "eth_getTransactionReceipt",
        vec![json!(tx_hash)],
    )
    .await?;

    if receipt.block_number.is_none() {
        return Err(PaymentError::Onchain(
            "transaction not yet finalized on-chain".into(),
        ));
    }
    if !is_success_status(receipt.status.as_deref()) {
        return Err(PaymentError::Onchain("transaction reverted".into()));
    }

    let required_amount = parse_u256_value(&requirements.max_amount_required)?;
    let pay_to = normalize_address(&requirements.pay_to);
    let asset = normalize_address(&requirements.asset);

    if asset == ZERO_ADDRESS {
        validate_native_transfer(&client, rpc_url, tx_hash, &pay_to, required_amount).await?;
    } else {
        validate_erc20_transfer(&receipt, &asset, &pay_to, required_amount)?;
    }

    info!(
        "On-chain payment settled: tx={} pay_to={} asset={} amount={}",
        tx_hash, requirements.pay_to, requirements.asset, requirements.max_amount_required
    );
    Ok(())
}

pub async fn settle_payment(
    payment_header: &str,
    accepted_payment_requirements: &[PaymentRequirements],
    facilitator: &FacilitatorClient,
    config: &X402Config,
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

    let scheme = envelope.scheme.to_lowercase();
    if scheme.contains("4mica") {
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
    } else if scheme == "exact" || scheme == "x402" {
        settle_onchain(&envelope, selected_requirement, config).await?;
    } else {
        return Err(PaymentError::UnsupportedScheme(envelope.scheme.clone()));
    }

    Ok(())
}
