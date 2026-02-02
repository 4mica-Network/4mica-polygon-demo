use sdk_4mica::x402::PaymentRequirements;
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct X402ResourceInfo {
    pub url: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mime_type: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PaymentRequirementsV2 {
    pub scheme: String,
    pub network: String,
    pub amount: String,
    pub asset: String,
    pub pay_to: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_timeout_seconds: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub extra: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PaymentRequiredV2 {
    pub x402_version: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    pub resource: X402ResourceInfo,
    pub accepts: Vec<PaymentRequirementsV2>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub extensions: Option<Value>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FacilitatorVerifyParams<'a> {
    pub x402_version: u64,
    pub payment_header: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub payment_payload: Option<Value>,
    pub payment_requirements: &'a PaymentRequirements,
}

pub type FacilitatorSettleParams<'a> = FacilitatorVerifyParams<'a>;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FacilitatorVerifyParamsV2<'a> {
    pub x402_version: u64,
    pub payment_header: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub payment_payload: Option<Value>,
    pub payment_requirements: &'a PaymentRequirementsV2,
}

pub type FacilitatorSettleParamsV2<'a> = FacilitatorVerifyParamsV2<'a>;

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

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FacilitatorTabRequestParams {
    pub user_address: String,
    pub recipient_address: String,
    pub erc20_token: String,
    pub ttl_seconds: Option<u64>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FacilitatorTabResponse {
    pub tab_id: String,
    pub user_address: String,
    pub recipient_address: String,
    pub asset_address: String,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        alias = "nextReqId",
        alias = "next_req_id",
        alias = "reqId",
        alias = "req_id"
    )]
    pub next_req_id: Option<String>,
    pub start_timestamp: i64,
    pub ttl_seconds: i64,
}
