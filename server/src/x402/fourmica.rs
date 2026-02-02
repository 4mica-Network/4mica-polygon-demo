use log::{info, warn};
use sdk_4mica::{Client as FourMicaClient, ConfigBuilder, U256};
use serde_json::Value;
use std::str::FromStr;

use crate::x402::config::X402Config;

fn parse_u256_value(raw: &str) -> Result<U256, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err("empty numeric value".into());
    }
    if let Some(stripped) = trimmed.strip_prefix("0x") {
        U256::from_str_radix(stripped, 16).map_err(|e| format!("invalid hex value {trimmed}: {e}"))
    } else {
        U256::from_str(trimmed).map_err(|e| format!("invalid decimal value {trimmed}: {e}"))
    }
}

fn extract_tab_id(envelope: &Value) -> Option<String> {
    envelope
        .get("payload")
        .and_then(|payload| payload.get("claims"))
        .and_then(|claims| claims.get("tabId").or_else(|| claims.get("tab_id")))
        .and_then(|tab| match tab {
            Value::String(s) => Some(s.clone()),
            Value::Number(n) => Some(n.to_string()),
            _ => None,
        })
}

fn extract_claim_field(envelope: &Value, key: &str) -> Option<String> {
    envelope
        .get("payload")
        .and_then(|payload| payload.get("claims"))
        .and_then(|claims| claims.get(key))
        .and_then(|val| match val {
            Value::String(s) => Some(s.clone()),
            Value::Number(n) => Some(n.to_string()),
            _ => None,
        })
}

fn fmt_u256(value: &U256) -> String {
    format!("{value}")
}

fn fmt_u256_hex(value: &U256) -> String {
    format!("0x{:x}", value)
}

async fn build_fourmica_client(config: &X402Config) -> Option<FourMicaClient> {
    let mut builder = ConfigBuilder::default().from_env();

    if !config.rpc_url.is_empty() {
        builder = builder.ethereum_http_rpc_url(config.rpc_url.clone());
    }

    let cfg = match builder.build() {
        Ok(cfg) => cfg,
        Err(err) => {
            warn!(
                "Skipping 4mica tab logging: failed to build config (set 4MICA_WALLET_PRIVATE_KEY?): {}",
                err
            );
            return None;
        }
    };

    match FourMicaClient::new(cfg).await {
        Ok(client) => Some(client),
        Err(err) => {
            warn!("Skipping 4mica tab logging: failed to init client: {}", err);
            None
        }
    }
}

async fn log_tab_snapshot(tab_id: U256, config: &X402Config) {
    let Some(client) = build_fourmica_client(config).await else {
        return;
    };

    let tab_info = client.recipient.get_tab(tab_id).await;
    let payment_status = client.recipient.get_tab_payment_status(tab_id).await;
    let guarantees = client.recipient.get_tab_guarantees(tab_id).await;
    let collateral_events = client.recipient.get_collateral_events_for_tab(tab_id).await;

    match tab_info {
        Ok(Some(tab)) => {
            info!(
                "[4mica] Tab info id={} user={} recipient={} asset={} status={} settlement_status={} ttl={} started_at={} created_at={} updated_at={}",
                fmt_u256_hex(&tab.tab_id),
                tab.user_address,
                tab.recipient_address,
                tab.asset_address,
                tab.status,
                tab.settlement_status,
                tab.ttl_seconds,
                tab.start_timestamp,
                tab.created_at,
                tab.updated_at
            );
        }
        Ok(None) => info!("[4mica] Tab {} not found via SDK", fmt_u256_hex(&tab_id)),
        Err(err) => warn!(
            "[4mica] Failed to fetch tab {}: {}",
            fmt_u256_hex(&tab_id),
            err
        ),
    }

    match payment_status {
        Ok(status) => {
            info!(
                "[4mica] Tab payment status id={} paid={} remunerated={} asset={}",
                fmt_u256_hex(&tab_id),
                fmt_u256(&status.paid),
                status.remunerated,
                status.asset
            );
        }
        Err(err) => warn!(
            "[4mica] Failed to fetch payment status for {}: {}",
            fmt_u256_hex(&tab_id),
            err
        ),
    }

    match guarantees {
        Ok(list) => {
            let total = list.iter().fold(U256::from(0), |acc, g| acc + g.amount);
            info!(
                "[4mica] Guarantees for tab {}: count={} total_amount={}",
                fmt_u256_hex(&tab_id),
                list.len(),
                fmt_u256(&total)
            );
            for g in list {
                info!(
                    "[4mica]  - req_id={} amount={} from={} to={} asset={} timestamp={}",
                    g.req_id,
                    fmt_u256(&g.amount),
                    g.from_address,
                    g.to_address,
                    g.asset_address,
                    g.timestamp
                );
            }
        }
        Err(err) => warn!(
            "[4mica] Failed to fetch guarantees for {}: {}",
            fmt_u256_hex(&tab_id),
            err
        ),
    }

    match collateral_events {
        Ok(events) => {
            info!(
                "[4mica] Collateral events for tab {}: count={}",
                fmt_u256_hex(&tab_id),
                events.len()
            );
            for ev in events {
                info!(
                    "[4mica]  - event_id={} type={} amount={} asset={} req_id={:?} tab_id={:?} tx_id={:?} created_at={}",
                    ev.id,
                    ev.event_type,
                    fmt_u256(&ev.amount),
                    ev.asset_address,
                    ev.req_id,
                    ev.tab_id,
                    ev.tx_id,
                    ev.created_at
                );
            }
        }
        Err(err) => warn!(
            "[4mica] Failed to fetch collateral events for {}: {}",
            fmt_u256_hex(&tab_id),
            err
        ),
    }
}

pub async fn log_fourmica_payment_info(envelope: &Value, config: &X402Config) {
    let tab_id_raw = extract_tab_id(envelope);
    let amount_raw = extract_claim_field(envelope, "amount");
    let user_addr = extract_claim_field(envelope, "userAddress")
        .or_else(|| extract_claim_field(envelope, "user_address"));
    let recipient_addr = extract_claim_field(envelope, "recipientAddress")
        .or_else(|| extract_claim_field(envelope, "recipient_address"));
    let asset_addr = extract_claim_field(envelope, "assetAddress")
        .or_else(|| extract_claim_field(envelope, "asset_address"));

    let tab_id_hex = tab_id_raw
        .as_ref()
        .and_then(|raw| parse_u256_value(raw).ok().map(|v| fmt_u256_hex(&v)));

    info!(
        "[4mica] Payment claims from header: tab_id={:?} user={:?} recipient={:?} amount={:?} asset={:?}",
        tab_id_hex.as_ref().or(tab_id_raw.as_ref()),
        user_addr,
        recipient_addr,
        amount_raw,
        asset_addr
    );

    if let Some(tab_id_raw) = tab_id_raw {
        match parse_u256_value(&tab_id_raw) {
            Ok(tab_id) => log_tab_snapshot(tab_id, config).await,
            Err(err) => warn!(
                "[4mica] Unable to parse tab id from payment header {}: {}",
                tab_id_raw, err
            ),
        }
    } else {
        warn!("[4mica] Payment header missing tab id; skipping SDK tab logging");
    }
}
