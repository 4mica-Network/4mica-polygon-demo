use log::info;
use reqwest::Client;
use rust_sdk_4mica::{U256, x402::PaymentRequirements};
use serde::Deserialize;
use serde_json::{Value, json};
use std::str::FromStr;

use crate::error::PaymentError;
use crate::x402::model::PaymentEnvelope;

const ZERO_ADDRESS: &str = "0000000000000000000000000000000000000000";

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
struct RpcReceipt {
    status: Option<String>,
    #[allow(dead_code)]
    to: Option<String>,
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
    client: &Client,
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

async fn validate_native_transfer(
    client: &Client,
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

pub async fn verify_native_payment(
    envelope: &PaymentEnvelope,
    requirements: &PaymentRequirements,
    rpc_url: &str,
) -> Result<(), PaymentError> {
    let tx_hash = envelope
        .payload
        .get("txHash")
        .or_else(|| envelope.payload.get("tx_hash"))
        .and_then(|v| v.as_str())
        .ok_or(PaymentError::MissingTxHash)?;
    let client = Client::new();

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
        return Err(PaymentError::Other("ERC20 transfers not supported".into()));
    }

    info!(
        "On-chain payment settled: tx={} pay_to={} asset={} amount={}",
        tx_hash, requirements.pay_to, requirements.asset, requirements.max_amount_required
    );
    Ok(())
}

pub fn is_native_asset(asset: &str) -> bool {
    normalize_address(asset) == ZERO_ADDRESS
}
