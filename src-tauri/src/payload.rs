//! Locate, verify, and unpack the portable payload.

use crate::Reporter;
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::fs::{self, File};
use std::io::{BufReader, Read};
use std::path::{Component, Path, PathBuf};
use tauri::Manager;

#[derive(Debug, Deserialize)]
pub struct Manifest {
    pub version: String,
    pub sha256: String,
    /// `<version>-<sha12>`; derived when an older manifest omits it.
    #[serde(default)]
    pub key: Option<String>,
}

pub struct Payload {
    /// Directory that contains `bin/pie.js`.
    pub dir: PathBuf,
    /// Payload version, compared against running server records.
    pub version: String,
}

pub fn prepare(app: &tauri::AppHandle, report: Reporter<'_>) -> Result<Payload, String> {
    let source = locate(app)?;

    if source.is_dir() {
        if !source.join("bin").join("pie.js").is_file() {
            return Err(format!(
                "{} does not contain bin/pie.js.",
                source.display()
            ));
        }
        return Ok(Payload {
            version: portable_version(&source).unwrap_or_else(|| "dev".to_string()),
            dir: source,
        });
    }

    let manifest = read_manifest(&source);
    if let Some(manifest) = manifest.as_ref() {
        report("Verifying the server payload\u{2026}", false);
        let digest = sha256(&source)
            .map_err(|error| format!("Could not read {}: {error}", source.display()))?;
        if !digest.eq_ignore_ascii_case(&manifest.sha256) {
            return Err(format!(
                "The server payload is corrupt (checksum mismatch):\n{}",
                source.display()
            ));
        }
    }

    let runtime = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("No writable app data directory: {error}"))?
        .join("runtime");
    let (key, version) = match manifest.as_ref() {
        Some(manifest) => {
            let key = manifest
                .key
                .clone()
                .unwrap_or_else(|| format!("{}-{}", manifest.version, short(&manifest.sha256)));
            (sanitize_key(&key)?, manifest.version.clone())
        }
        None => {
            let stamp = fs::metadata(&source)
                .ok()
                .and_then(|metadata| metadata.modified().ok())
                .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|duration| duration.as_secs())
                .unwrap_or(0);
            (format!("dev-{stamp}"), "dev".to_string())
        }
    };

    let app_dir = runtime.join(&key).join("pie");
    if app_dir.join("bin").join("pie.js").is_file() {
        cleanup(&runtime, &key);
        return Ok(Payload {
            dir: app_dir,
            version,
        });
    }

    report("Unpacking the server payload\u{2026}", false);
    extract(&source, &runtime, &key)?;
    if !app_dir.join("bin").join("pie.js").is_file() {
        return Err(format!(
            "The unpacked payload is incomplete: {} has no bin/pie.js.",
            app_dir.display()
        ));
    }
    cleanup(&runtime, &key);
    Ok(Payload {
        dir: app_dir,
        version,
    })
}

fn locate(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let mut tried: Vec<PathBuf> = Vec::new();

    if let Some(value) = std::env::var_os("PIE_DESKTOP_PAYLOAD") {
        let path = PathBuf::from(value);
        if path.exists() {
            return Ok(path);
        }
        tried.push(path);
    }

    // Bundled apps (macOS, Windows) and hand-made archives place the payload
    // beside the resources or the binary.
    let mut roots: Vec<PathBuf> = Vec::new();
    if let Ok(resource) = app.path().resource_dir() {
        roots.push(resource);
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            roots.push(dir.to_path_buf());
        }
    }
    for root in roots {
        for name in ["payload.tar.gz", "payload"] {
            let path = root.join(name);
            if path.exists() {
                return Ok(path);
            }
            tried.push(path);
        }
    }

    Err(format!(
        "The Pie server payload was not found. Looked for:\n{}",
        tried
            .iter()
            .map(|path| format!("  {}", path.display()))
            .collect::<Vec<_>>()
            .join("\n")
    ))
}

fn read_manifest(archive: &Path) -> Option<Manifest> {
    let file = archive.parent()?.join("payload.json");
    let text = fs::read_to_string(file).ok()?;
    serde_json::from_str(&text).ok()
}

fn portable_version(dir: &Path) -> Option<String> {
    let text = fs::read_to_string(dir.join("PORTABLE.json")).ok()?;
    let value: serde_json::Value = serde_json::from_str(&text).ok()?;
    value.get("version")?.as_str().map(str::to_string)
}

fn short(sha256: &str) -> String {
    sha256.chars().take(12).collect()
}

fn sanitize_key(key: &str) -> Result<String, String> {
    if key.is_empty()
        || !key.chars().all(|character| {
            character.is_ascii_alphanumeric() || matches!(character, '.' | '-' | '_' | '+')
        })
    {
        return Err(format!("Unusable payload key: {key}"));
    }
    Ok(key.to_string())
}

fn sha256(path: &Path) -> std::io::Result<String> {
    let mut file = BufReader::new(File::open(path)?);
    let mut hasher = Sha256::new();
    let mut buffer = [0u8; 64 * 1024];
    loop {
        let read = file.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

/// Archive entries may only be relative paths without `..`.
pub fn is_safe_entry(path: &Path) -> bool {
    !path.as_os_str().is_empty()
        && path
            .components()
            .all(|component| matches!(component, Component::Normal(_) | Component::CurDir))
}

fn extract(archive: &Path, runtime: &Path, key: &str) -> Result<(), String> {
    fs::create_dir_all(runtime)
        .map_err(|error| format!("Could not create {}: {error}", runtime.display()))?;
    let partial = runtime.join(format!(".{key}.partial"));
    let _ = fs::remove_dir_all(&partial);
    fs::create_dir_all(&partial)
        .map_err(|error| format!("Could not create {}: {error}", partial.display()))?;

    let result = (|| -> Result<(), String> {
        let file = File::open(archive)
            .map_err(|error| format!("Could not read {}: {error}", archive.display()))?;
        let decoder = flate2::read::GzDecoder::new(BufReader::new(file));
        let mut tar = tar::Archive::new(decoder);
        let entries = tar
            .entries()
            .map_err(|error| format!("Could not read the payload archive: {error}"))?;
        for entry in entries {
            let mut entry =
                entry.map_err(|error| format!("Could not read the payload archive: {error}"))?;
            let path = entry
                .path()
                .map_err(|error| format!("Could not read a payload entry: {error}"))?
                .into_owned();
            if !is_safe_entry(&path) {
                return Err(format!(
                    "The payload archive contains an unsafe path: {}",
                    path.display()
                ));
            }
            entry
                .unpack_in(&partial)
                .map_err(|error| format!("Could not unpack {}: {error}", path.display()))?;
        }
        Ok(())
    })();

    if let Err(error) = result {
        let _ = fs::remove_dir_all(&partial);
        return Err(error);
    }

    let target = runtime.join(key);
    if target.exists() {
        fs::remove_dir_all(&target)
            .map_err(|error| format!("Could not replace {}: {error}", target.display()))?;
    }
    fs::rename(&partial, &target).map_err(|error| {
        let _ = fs::remove_dir_all(&partial);
        format!(
            "Could not finish unpacking into {}: {error}",
            target.display()
        )
    })
}

/// Keep only the current payload. An older directory can belong to a server the
/// shell adopted, so failures are ignored rather than reported.
fn cleanup(runtime: &Path, key: &str) {
    let Ok(entries) = fs::read_dir(runtime) else {
        return;
    };
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if name == key || name.starts_with(&format!(".{key}.partial")) {
            continue;
        }
        let _ = fs::remove_dir_all(entry.path());
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write_archive(path: &Path, entries: &[(&str, &str)]) {
        let file = File::create(path).unwrap();
        let encoder = flate2::write::GzEncoder::new(file, flate2::Compression::fast());
        let mut builder = tar::Builder::new(encoder);
        for (name, body) in entries {
            let mut header = tar::Header::new_gnu();
            header.set_size(body.len() as u64);
            header.set_mode(0o644);
            header.set_cksum();
            builder
                .append_data(&mut header, name, body.as_bytes())
                .unwrap();
        }
        builder.into_inner().unwrap().finish().unwrap();
    }

    fn workspace(name: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("pie-payload-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn unpacks_a_payload_and_replaces_an_older_copy() {
        let root = workspace("extract");
        let archive = root.join("payload.tar.gz");
        write_archive(
            &archive,
            &[
                ("pie/bin/pie.js", "console.log('server')"),
                ("pie/PORTABLE.json", "{\"version\":\"0.1.0\"}"),
            ],
        );
        let runtime = root.join("runtime");

        extract(&archive, &runtime, "0.1.0-abcdef123456").unwrap();
        let target = runtime.join("0.1.0-abcdef123456");
        assert!(target.join("pie/bin/pie.js").is_file());
        assert_eq!(
            portable_version(&target.join("pie")).as_deref(),
            Some("0.1.0")
        );
        assert!(!runtime.join(".0.1.0-abcdef123456.partial").exists());

        fs::write(target.join("stale.txt"), "old").unwrap();
        extract(&archive, &runtime, "0.1.0-abcdef123456").unwrap();
        assert!(!target.join("stale.txt").exists());
        assert!(target.join("pie/bin/pie.js").is_file());

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn cleanup_keeps_the_current_payload_only() {
        let root = workspace("cleanup");
        let runtime = root.join("runtime");
        fs::create_dir_all(runtime.join("old-111111111111")).unwrap();
        fs::create_dir_all(runtime.join("current-222222222222")).unwrap();
        fs::write(runtime.join("keep.txt"), "not a payload directory").unwrap();

        cleanup(&runtime, "current-222222222222");

        assert!(runtime.join("current-222222222222").is_dir());
        assert!(!runtime.join("old-111111111111").exists());
        assert!(runtime.join("keep.txt").is_file());

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn accepts_relative_archive_entries() {
        assert!(is_safe_entry(Path::new("pie/bin/pie.js")));
        assert!(is_safe_entry(Path::new("./pie/package.json")));
    }

    #[test]
    fn rejects_escaping_archive_entries() {
        assert!(!is_safe_entry(Path::new("/etc/passwd")));
        assert!(!is_safe_entry(Path::new("../outside")));
        assert!(!is_safe_entry(Path::new("pie/../../outside")));
        assert!(!is_safe_entry(Path::new("")));
    }

    #[test]
    fn derived_keys_stay_inside_the_runtime_directory() {
        assert_eq!(
            sanitize_key("0.1.0-abcdef123456").unwrap(),
            "0.1.0-abcdef123456"
        );
        assert!(sanitize_key("../escape").is_err());
        assert!(sanitize_key("a/b").is_err());
        assert!(sanitize_key("").is_err());
        assert_eq!(short("0123456789abcdef"), "0123456789ab");
    }
}
