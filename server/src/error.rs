use std::path::PathBuf;
use thiserror::Error;

#[derive(Error, Debug)]
pub enum FileStreamError {
    #[error("File not found: {0}")]
    NotFound(PathBuf),

    #[error("Path is not a file: {0}")]
    NotAFile(PathBuf),

    #[error("Access denied: path is outside allowed directory")]
    AccessDenied,

    #[error("Failed to open file: {0}")]
    IoError(#[from] std::io::Error),
}

#[derive(Error, Debug)]
pub enum PaymentError {
    #[error("Failed to decode payment header: {0}")]
    Base64Decode(#[from] base64::DecodeError),

    #[error("Failed to parse payment envelope: {0}")]
    JsonParse(#[from] serde_json::Error),

    #[error("Facilitator error: {0}")]
    Facilitator(#[from] crate::x402::FacilitatorClientError),

    #[error("Settlement failed: {0}")]
    SettlementFailed(String),
}
