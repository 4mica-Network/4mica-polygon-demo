use rust_sdk_4mica::x402::PaymentRequirements;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FacilitatorVerifyParams {
    pub x402_version: u64,
    pub payment_header: String,
    pub payment_requirements: PaymentRequirements,
}

pub type FacilitatorSettleParams = FacilitatorVerifyParams;

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
