use sdk_4mica::x402::PaymentRequirements;
use serde::{Deserialize, Serialize};
use serde_json::Value;

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
    pub payment_requirements: TabPaymentRequirements,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TabPaymentRequirements {
    pub scheme: String,
    pub network: String,
    #[serde(default)]
    pub max_amount_required: Option<String>,
    #[serde(default)]
    pub amount: Option<String>,
    #[serde(default)]
    pub resource: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub mime_type: Option<String>,
    #[serde(default)]
    pub output_schema: Option<Value>,
    pub pay_to: String,
    #[serde(default)]
    pub max_timeout_seconds: Option<u64>,
    pub asset: String,
    #[serde(default)]
    pub extra: Option<Value>,
}

impl TabPaymentRequirements {
    pub fn into_payment_requirements(self) -> PaymentRequirements {
        let max_amount_required = self
            .max_amount_required
            .filter(|value| !value.is_empty())
            .or(self.amount.clone())
            .unwrap_or_default();
        PaymentRequirements {
            scheme: self.scheme,
            network: self.network,
            max_amount_required,
            resource: self.resource,
            description: self.description,
            mime_type: self.mime_type,
            output_schema: self.output_schema,
            pay_to: self.pay_to,
            max_timeout_seconds: self.max_timeout_seconds,
            asset: self.asset,
            extra: self.extra,
        }
    }
}
