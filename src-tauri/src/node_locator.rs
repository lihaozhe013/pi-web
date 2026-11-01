//! Node.js discovery.
//!
//! A GUI process does not inherit the shell `PATH` on macOS, and people install
//! Node.js with version managers, so probing `PATH` alone finds nothing for a
//! large part of the intended audience. The order below is: explicit choice, the
//! shell `PATH`, then the layouts the common installers and version managers use.

use crate::config;
use crate::Reporter;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};
use tauri::AppHandle;

/// The Next.js floor. Older releases are reported instead of used.
pub const MINIMUM: Version = Version {
    major: 20,
    minor: 9,
    patch: 0,
};

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub struct Version {
    pub major: u64,
    pub minor: u64,
    pub patch: u64,
}

impl Version {
    pub fn parse(text: &str) -> Option<Self> {
        let trimmed = text.trim();
        let trimmed = trimmed.strip_prefix('v').unwrap_or(trimmed);
        let mut parts = trimmed.split('.');
        let major = parts.next()?.parse().ok()?;
        let minor = parts
            .next()
            .map(|part| part.parse().ok())
            .unwrap_or(Some(0))?;
        let patch = match parts.next() {
            Some(part) => part.split(['-', '+']).next().unwrap_or(part).parse().ok()?,
            None => 0,
        };
        Some(Self {
            major,
            minor,
            patch,
        })
    }

    pub fn supported(self) -> bool {
        self >= MINIMUM
    }
}

impl std::fmt::Display for Version {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(formatter, "{}.{}.{}", self.major, self.minor, self.patch)
    }
}

pub struct Located {
    pub path: PathBuf,
    pub version: Version,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Platform {
    Unix,
    Windows,
}

impl Platform {
    pub fn current() -> Self {
        if cfg!(windows) {
            Self::Windows
        } else {
            Self::Unix
        }
    }

    fn executable(self) -> &'static str {
        match self {
            Self::Unix => "node",
            Self::Windows => "node.exe",
        }
    }
}

/// Candidate locations, in priority order.
pub struct Search {
    pub platform: Platform,
    pub configured: Option<PathBuf>,
    /// Entries of the `PATH` variable, already split.
    pub path_dirs: Vec<PathBuf>,
    pub fixed_dirs: Vec<PathBuf>,
    /// `(root, suffix under each version directory)`.
    pub version_roots: Vec<(PathBuf, Vec<String>)>,
}

impl Search {
    pub fn from_environment(configured: Option<PathBuf>) -> Self {
        let platform = Platform::current();
        let home = std::env::var_os("HOME")
            .or_else(|| std::env::var_os("USERPROFILE"))
            .map(PathBuf::from);
        let mut fixed_dirs = Vec::new();
        let mut version_roots = Vec::new();

        if platform == Platform::Unix {
            for dir in [
                "/opt/homebrew/bin",
                "/usr/local/bin",
                "/usr/bin",
                "/opt/local/bin",
                "/snap/bin",
            ] {
                fixed_dirs.push(PathBuf::from(dir));
            }
            if let Some(home) = home.as_deref() {
                for dir in [".volta/bin", ".asdf/shims", ".local/bin"] {
                    fixed_dirs.push(home.join(dir));
                }
                version_roots.push((home.join(".nvm/versions/node"), vec!["bin".to_string()]));
                for root in [
                    home.join(".local/share/fnm/node-versions"),
                    home.join("Library/Application Support/fnm/node-versions"),
                ] {
                    version_roots.push((root, vec!["installation".to_string(), "bin".to_string()]));
                }
                version_roots.push((
                    home.join(".volta/tools/image/node"),
                    vec!["bin".to_string()],
                ));
            }
        } else {
            for variable in ["ProgramFiles", "ProgramFiles(x86)"] {
                if let Some(root) = std::env::var_os(variable) {
                    fixed_dirs.push(PathBuf::from(root).join("nodejs"));
                }
            }
            for variable in ["LOCALAPPDATA", "APPDATA"] {
                let Some(root) = std::env::var_os(variable).map(PathBuf::from) else {
                    continue;
                };
                fixed_dirs.push(root.join("Programs").join("nodejs"));
                fixed_dirs.push(root.join("fnm").join("node-versions"));
                version_roots.push((root.join("nvm"), Vec::new()));
            }
            if let Some(home) = home.as_deref() {
                fixed_dirs.push(
                    home.join("scoop")
                        .join("apps")
                        .join("nodejs")
                        .join("current"),
                );
            }
        }

        let path_dirs = std::env::var_os("PATH")
            .map(|path| {
                std::env::split_paths(&path)
                    .filter(|dir| !dir.as_os_str().is_empty())
                    .collect()
            })
            .unwrap_or_default();

        Self {
            platform,
            configured,
            path_dirs,
            fixed_dirs,
            version_roots,
        }
    }
}

pub fn candidates(search: &Search) -> Vec<PathBuf> {
    let executable = search.platform.executable();
    let mut found = Vec::new();
    if let Some(configured) = &search.configured {
        found.push(configured.clone());
    }
    for dir in &search.path_dirs {
        found.push(dir.join(executable));
    }
    for dir in &search.fixed_dirs {
        found.push(dir.join(executable));
    }
    for (root, suffix) in &search.version_roots {
        found.extend(version_dirs(root, suffix, executable));
    }
    found
}

/// `root/<version>/<suffix>/node`, newest version first.
fn version_dirs(root: &Path, suffix: &[String], executable: &str) -> Vec<PathBuf> {
    let Ok(entries) = std::fs::read_dir(root) else {
        return Vec::new();
    };
    let mut versions: Vec<(Version, PathBuf)> = entries
        .flatten()
        .filter_map(|entry| {
            let path = entry.path();
            if !path.is_dir() {
                return None;
            }
            let name = entry.file_name().to_string_lossy().to_string();
            let version = Version::parse(&name)?;
            let mut dir = path;
            for part in suffix {
                dir = dir.join(part);
            }
            Some((version, dir.join(executable)))
        })
        .collect();
    versions.sort_by(|left, right| right.0.cmp(&left.0));
    versions.into_iter().map(|(_, path)| path).collect()
}

pub fn resolve(app: &AppHandle, report: Reporter<'_>) -> Result<Located, String> {
    let settings = config::read(app);
    let configured = std::env::var("PIE_DESKTOP_NODE")
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .or_else(|| settings.node_path());

    if let Some(path) = configured.as_ref() {
        if !path.is_file() {
            return Err(format!(
                "The configured Node.js binary does not exist:\n{}\n\nFix PIE_DESKTOP_NODE or the nodePath entry in {}.",
                path.display(),
                config_path(app)
            ));
        }
        return match probe_version(path) {
            Some(version) if version.supported() => Ok(Located {
                path: path.clone(),
                version,
            }),
            Some(version) => Err(format!(
                "Node.js at {} is {version}. Pie needs {MINIMUM} or newer.",
                path.display()
            )),
            None => Err(format!(
                "Could not run {} as Node.js.\n\nFix PIE_DESKTOP_NODE or the nodePath entry in {}.",
                path.display(),
                config_path(app)
            )),
        };
    }

    report("Looking for Node.js\u{2026}", false);
    let search = Search::from_environment(None);
    let mut too_old: Vec<(PathBuf, Version)> = Vec::new();
    for candidate in candidates(&search) {
        if !candidate.is_file() {
            continue;
        }
        let Some(version) = probe_version(&candidate) else {
            continue;
        };
        if version.supported() {
            return Ok(Located {
                path: candidate,
                version,
            });
        }
        too_old.push((candidate, version));
    }

    let mut message = format!(
        "Node.js {MINIMUM} or newer was not found.\n\nSearched:\n{}",
        searched(&search)
    );
    if let Some((path, version)) = too_old.first() {
        message.push_str(&format!(
            "\n\nThe oldest usable name found was {} ({version}), which is too old.",
            path.display()
        ));
    }
    message.push_str(&format!(
        "\n\nInstall Node.js, or name a binary with PIE_DESKTOP_NODE or in {}:\n\n  {{ \"nodePath\": \"/path/to/node\" }}",
        config_path(app)
    ));
    Err(message)
}

fn searched(search: &Search) -> String {
    let executable = search.platform.executable();
    let mut lines: Vec<String> = search
        .fixed_dirs
        .iter()
        .map(|dir| format!("  {}", dir.join(executable).display()))
        .collect();
    for (root, _) in &search.version_roots {
        lines.push(format!("  {}/<version>/\u{2026}", root.display()));
    }
    lines.push(format!("  every {executable} on PATH"));
    lines.join("\n")
}

fn config_path(app: &AppHandle) -> String {
    config::path(app)
        .map(|path| path.display().to_string())
        .unwrap_or_else(|| "the desktop config file".to_string())
}

/// Report the Node.js version, or `None` when the binary does not run.
pub fn probe_version(path: &Path) -> Option<Version> {
    let stdout = run_capture(
        path,
        &["-p", "process.versions.node"],
        Duration::from_secs(15),
    )?;
    Version::parse(&stdout)
}

pub fn run_capture(program: &Path, args: &[&str], timeout: Duration) -> Option<String> {
    let mut command = Command::new(program);
    command
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    quiet(&mut command);
    let mut child = command.spawn().ok()?;
    let mut stdout = child.stdout.take()?;
    let reader = std::thread::spawn(move || {
        let mut text = String::new();
        let _ = stdout.read_to_string(&mut text);
        text
    });
    let deadline = Instant::now() + timeout;
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) if Instant::now() < deadline => {
                std::thread::sleep(Duration::from_millis(20));
            }
            Ok(None) => {
                let _ = child.kill();
                let _ = child.wait();
                break;
            }
            Err(_) => {
                let _ = child.kill();
                break;
            }
        }
    }
    reader.join().ok()
}

/// Keep helper processes from flashing a console window on Windows.
pub fn quiet(command: &mut Command) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    #[cfg(not(windows))]
    {
        let _ = command;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn search(platform: Platform, configured: Option<&str>, path: &[&str]) -> Search {
        Search {
            platform,
            configured: configured.map(PathBuf::from),
            path_dirs: path.iter().map(PathBuf::from).collect(),
            fixed_dirs: vec![PathBuf::from("/fixed/bin")],
            version_roots: vec![(PathBuf::from("/versions"), vec!["bin".to_string()])],
        }
    }

    #[test]
    fn parses_versions_with_and_without_v() {
        assert_eq!(
            Version::parse("v24.4.0"),
            Some(Version {
                major: 24,
                minor: 4,
                patch: 0
            })
        );
        assert_eq!(Version::parse("20.9.0\n"), Version::parse("20.9"));
        assert_eq!(
            Version::parse("22.1.0-rc.1").map(|version| version.patch),
            Some(0)
        );
        assert_eq!(Version::parse("nope"), None);
    }

    #[test]
    fn enforces_the_next_floor() {
        assert!(!Version::parse("20.8.9").unwrap().supported());
        assert!(Version::parse("20.9.0").unwrap().supported());
        assert!(Version::parse("24.4.0").unwrap().supported());
    }

    #[test]
    fn prefers_the_configured_binary_then_path() {
        let found = candidates(&search(Platform::Unix, Some("/custom/node"), &["/a", "/b"]));
        assert_eq!(found[0], PathBuf::from("/custom/node"));
        assert_eq!(found[1], PathBuf::from("/a/node"));
        assert_eq!(found[2], PathBuf::from("/b/node"));
        assert_eq!(found[3], PathBuf::from("/fixed/bin/node"));
    }

    #[test]
    fn uses_the_platform_executable_name() {
        let found = candidates(&search(Platform::Windows, None, &[r"C:\nodejs"]));
        assert_eq!(found[0], PathBuf::from(r"C:\nodejs").join("node.exe"));
    }

    #[test]
    fn orders_version_manager_directories_newest_first() {
        let root = std::env::temp_dir().join(format!("pie-node-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        for version in ["v20.9.0", "v24.4.0", "v22.11.0", "not-a-version"] {
            std::fs::create_dir_all(root.join(version).join("bin")).unwrap();
        }
        let found = version_dirs(&root, &["bin".to_string()], "node");
        let _ = std::fs::remove_dir_all(&root);
        assert_eq!(
            found,
            vec![
                root.join("v24.4.0").join("bin").join("node"),
                root.join("v22.11.0").join("bin").join("node"),
                root.join("v20.9.0").join("bin").join("node"),
            ]
        );
    }
}
