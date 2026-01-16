/// Copied and modified from x402-axum crate: https://github.com/x402-rs/x402-rs/blob/main/crates/x402-axum/src/facilitator_client.rs
use http::{HeaderMap, StatusCode};
use reqwest::Client;
use serde_json;
use std::time::Duration;
use url::Url;

use crate::x402::model::{
    FacilitatorSettleParams, FacilitatorSettleResponse, FacilitatorTabRequestParams,
    FacilitatorTabResponse, FacilitatorVerifyParams, FacilitatorVerifyResponse,
};

/// A client for communicating with a remote x402 facilitator.
///
/// Handles `/verify` and `/settle` endpoints via JSON HTTP POST.
#[derive(Clone, Debug)]
pub struct FacilitatorClient {
    /// Base URL of the facilitator (e.g. `https://facilitator.example/`)
    #[allow(dead_code)] // Public for consumption by downstream crates.
    base_url: Url,
    /// Full URL to `POST /verify` requests
    verify_url: Url,
    /// Full URL to `POST /settle` requests
    settle_url: Url,
    /// Full URL to `GET /supported` requests
    #[allow(dead_code)] // Public for consumption by downstream crates.
    supported_url: Url,
    /// Full URL to `POST /tab` requests
    tab_url: Url,
    /// Shared Reqwest HTTP client
    client: Client,
    /// Optional custom headers sent with each request
    headers: HeaderMap,
    /// Optional request timeout
    timeout: Option<Duration>,
}

/// Errors that can occur while interacting with a remote facilitator.
#[derive(Debug, thiserror::Error)]
pub enum FacilitatorClientError {
    #[error("URL parse error: {context}: {source}")]
    UrlParse {
        context: &'static str,
        #[source]
        source: url::ParseError,
    },
    #[error("HTTP error: {context}: {source}")]
    Http {
        context: &'static str,
        #[source]
        source: reqwest::Error,
    },
    #[error("Failed to deserialize JSON: {context}: {source}")]
    JsonDeserialization {
        context: &'static str,
        #[source]
        source: serde_json::Error,
    },
    #[error("Unexpected HTTP status {status}: {context}: {body}")]
    HttpStatus {
        context: &'static str,
        status: StatusCode,
        body: String,
    },
    #[error("Failed to read response body as text: {context}: {source}")]
    ResponseBodyRead {
        context: &'static str,
        #[source]
        source: reqwest::Error,
    },
}

impl FacilitatorClient {
    /// Constructs a new [`FacilitatorClient`] from a base URL.
    ///
    /// This sets up `./verify` and `./settle` endpoint URLs relative to the base.
    pub fn try_new(mut base_url: Url) -> Result<Self, FacilitatorClientError> {
        if base_url.host_str() == Some("0.0.0.0") {
            log::warn!(
                "Facilitator URL host is 0.0.0.0; rewriting to 127.0.0.1 for client requests"
            );
            base_url
                .set_host(Some("127.0.0.1"))
                .map_err(|e| FacilitatorClientError::UrlParse {
                    context: "Failed to rewrite facilitator host",
                    source: e,
                })?;
        }
        let client = Client::new();
        log::info!("Initializing facilitator client at {}", base_url);
        let verify_url =
            base_url
                .join("./verify")
                .map_err(|e| FacilitatorClientError::UrlParse {
                    context: "Failed to construct ./verify URL",
                    source: e,
                })?;
        let settle_url =
            base_url
                .join("./settle")
                .map_err(|e| FacilitatorClientError::UrlParse {
                    context: "Failed to construct ./settle URL",
                    source: e,
                })?;
        let supported_url =
            base_url
                .join("./supported")
                .map_err(|e| FacilitatorClientError::UrlParse {
                    context: "Failed to construct ./supported URL",
                    source: e,
                })?;

        let tab_url = base_url
            .join("./tabs")
            .map_err(|e| FacilitatorClientError::UrlParse {
                context: "Failed to construct ./tabs URL",
                source: e,
            })?;

        log::info!(
            "Facilitator endpoints: verify={} settle={} supported={} tabs={}",
            verify_url,
            settle_url,
            supported_url,
            tab_url
        );

        Ok(Self {
            client,
            base_url,
            verify_url,
            settle_url,
            supported_url,
            tab_url,
            headers: HeaderMap::new(),
            timeout: None,
        })
    }

    /// Attaches custom headers to all future requests.
    #[allow(dead_code)] // Public for consumption by downstream crates.
    pub fn with_headers(&self, headers: HeaderMap) -> Self {
        let mut this = self.clone();
        this.headers = headers;
        this
    }

    /// Sets a timeout for all future requests.
    #[allow(dead_code)] // Public for consumption by downstream crates.
    pub fn with_timeout(&self, timeout: Duration) -> Self {
        let mut this = self.clone();
        this.timeout = Some(timeout);
        this
    }

    /// Sends a `POST /verify` request to the facilitator.
    pub async fn verify(
        &self,
        request: &FacilitatorVerifyParams<'_>,
    ) -> Result<FacilitatorVerifyResponse, FacilitatorClientError> {
        self.post_json(&self.verify_url, "POST /verify", request)
            .await
    }

    /// Sends a `POST /settle` request to the facilitator.
    pub async fn settle(
        &self,
        request: &FacilitatorSettleParams<'_>,
    ) -> Result<FacilitatorSettleResponse, FacilitatorClientError> {
        self.post_json(&self.settle_url, "POST /settle", request)
            .await
    }

    /// Sends a `POST /tabs` request to the facilitator with caching.
    ///
    /// Tabs are cached to prevent duplicate requests.
    pub async fn request_tab(
        &self,
        request: &FacilitatorTabRequestParams,
    ) -> Result<FacilitatorTabResponse, FacilitatorClientError> {
        log::info!("POST /tabs to facilitator {}", self.tab_url);
        let response: FacilitatorTabResponse = self
            .post_json(&self.tab_url, "POST /tabs", &request)
            .await?;

        Ok(response)
    }

    /// Generic POST helper that handles JSON serialization, error mapping,
    /// timeout application, and telemetry integration.
    ///
    /// `context` is a human-readable identifier used in tracing and error messages (e.g. `"POST /verify"`).
    async fn post_json<T, R>(
        &self,
        url: &Url,
        context: &'static str,
        payload: &T,
    ) -> Result<R, FacilitatorClientError>
    where
        T: serde::Serialize + ?Sized,
        R: serde::de::DeserializeOwned,
    {
        let payload_json =
            serde_json::to_string(payload).unwrap_or_else(|_| "<serialize_failed>".into());
        log::debug!(
            "Facilitator request: context={} url={} payload={}",
            context,
            url,
            payload_json
        );

        let mut req = self.client.post(url.clone()).json(payload);
        for (key, value) in self.headers.iter() {
            req = req.header(key, value);
        }
        if let Some(timeout) = self.timeout {
            req = req.timeout(timeout);
        }
        let http_response = req
            .send()
            .await
            .map_err(|e| FacilitatorClientError::Http { context, source: e })?;

        let status = http_response.status();
        let body = http_response
            .text()
            .await
            .map_err(|e| FacilitatorClientError::ResponseBodyRead { context, source: e })?;

        log::debug!(
            "Facilitator response: context={} status={} body={}",
            context,
            status,
            body
        );

        if status == StatusCode::OK {
            serde_json::from_str::<R>(&body)
                .map_err(|e| FacilitatorClientError::JsonDeserialization { context, source: e })
        } else {
            Err(FacilitatorClientError::HttpStatus {
                context,
                status,
                body,
            })
        }
    }

    /// Generic GET helper that handles JSON serialization, error mapping,
    /// timeout application, and telemetry integration.
    ///
    /// `context` is a human-readable identifier used in tracing and error messages (e.g. `"POST /verify"`).
    #[allow(dead_code)]
    async fn get_json<R>(
        &self,
        url: &Url,
        context: &'static str,
    ) -> Result<R, FacilitatorClientError>
    where
        R: serde::de::DeserializeOwned,
    {
        log::debug!("Facilitator request: context={} url={}", context, url);
        let mut req = self.client.get(url.clone());
        for (key, value) in self.headers.iter() {
            req = req.header(key, value);
        }
        if let Some(timeout) = self.timeout {
            req = req.timeout(timeout);
        }
        let http_response = req
            .send()
            .await
            .map_err(|e| FacilitatorClientError::Http { context, source: e })?;

        let status = http_response.status();
        let body = http_response
            .text()
            .await
            .map_err(|e| FacilitatorClientError::ResponseBodyRead { context, source: e })?;

        log::debug!(
            "Facilitator response: context={} status={} body={}",
            context,
            status,
            body
        );

        if status == StatusCode::OK {
            serde_json::from_str::<R>(&body)
                .map_err(|e| FacilitatorClientError::JsonDeserialization { context, source: e })
        } else {
            Err(FacilitatorClientError::HttpStatus {
                context,
                status,
                body,
            })
        }
    }
}
