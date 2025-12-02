use rust_sdk_4mica::x402::PaymentRequirements;
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PaymentEnvelope {
    pub x402_version: u64,
    pub scheme: String,
    pub network: String,
    pub payload: Value,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FacilitatorVerifyParams<'a> {
    pub x402_version: u64,
    pub payment_header: &'a str,
    pub payment_requirements: &'a PaymentRequirements,
}

pub type FacilitatorSettleParams<'a> = FacilitatorVerifyParams<'a>;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FourMicaCertificate {
    pub claims: String,
    pub signature: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FacilitatorVerifyResponse {
    pub is_valid: bool,
    pub invalid_reason: Option<String>,
    pub certificate: Option<FourMicaCertificate>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FacilitatorSettleResponse {
    pub success: bool,
    pub error: Option<String>,
    pub tx_hash: Option<String>,
    pub network_id: Option<String>,
    pub certificate: Option<FourMicaCertificate>,
}
