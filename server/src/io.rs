use axum::body::Body;
use std::path::{Path, PathBuf};
use tokio_util::io::ReaderStream;

use crate::error::FileStreamError;

pub fn verify_file(base_directory: &str, filename: &str) -> Result<PathBuf, FileStreamError> {
    let file_path = Path::new(base_directory).join(filename);

    if !file_path.exists() {
        return Err(FileStreamError::NotFound(file_path));
    }

    if !file_path.is_file() {
        return Err(FileStreamError::NotAFile(file_path));
    }

    if !file_path.starts_with(base_directory) {
        return Err(FileStreamError::AccessDenied);
    }

    Ok(file_path)
}

pub async fn stream_file(file_path: impl AsRef<Path>) -> Result<Body, FileStreamError> {
    let file = tokio::fs::File::open(file_path.as_ref()).await?;
    let stream = ReaderStream::new(file);
    let body = Body::from_stream(stream);

    Ok(body)
}

pub async fn stream_remote_file(url: &str) -> Result<Body, anyhow::Error> {
    let response = reqwest::get(url).await?;

    if !response.status().is_success() {
        return Err(anyhow::anyhow!(
            "Failed to fetch remote file: HTTP {}",
            response.status()
        ));
    }

    let stream = response.bytes_stream();
    let body = Body::from_stream(stream);

    Ok(body)
}
