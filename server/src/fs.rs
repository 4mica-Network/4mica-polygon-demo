use axum::body::Body;
use std::path::Path;
use tokio_util::io::ReaderStream;

use crate::error::FileStreamError;

pub async fn stream_file(base_directory: &str, filename: &str) -> Result<Body, FileStreamError> {
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

    let file = tokio::fs::File::open(&file_path).await?;
    let stream = ReaderStream::new(file);
    let body = Body::from_stream(stream);

    Ok(body)
}
