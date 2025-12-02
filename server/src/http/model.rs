use rust_sdk_4mica::x402::PaymentRequirements;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PaymentRequiredResponse {
    pub x402_version: u64,
    pub accepts: Vec<PaymentRequirements>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TabRequestParams {
    pub user_address: String,
    pub payment_requirements: PaymentRequirements,
}
