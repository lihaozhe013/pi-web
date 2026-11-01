//! Own the Pi Web server process: choose a port, start the launcher, wait for it,
//! and stop it again.

use crate::config;
use crate::http_probe;
use crate::node_locator;
use crate::payload;
use crate::{Reporter, Shared};
use serde::Deserialize;
use std::collections::VecDeque;
use std::fs::{self, OpenOptions};
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, ExitStatus, Stdio};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager, Url};

pub const DEFAULT_PORT: u16 = 3888;
/// How many ports above the preferred one the shell tries before an OS-assigned one.
const PORT_ATTEMPTS: u16 = 10;
const STARTUP_TIMEOUT: Duration = Duration::from_secs(90);
const ATTACH_TIMEOUT: Duration = Duration::from_secs(60);
const LOG_LINES: usize = 200;

pub struct Server {
    child: Option<Child>,
}

impl Server {
    pub fn poll_exit(&mut self) -> Option<ExitStatus> {
        let child = self.child.as_mut()?;
        child.try_wait().ok().flatten()
    }

    pub fn stop(&mut self) {
        if let Some(mut child) = self.child.take() {
            stop_process_tree(&mut child);
        }
    }
}

type LogLines = Arc<Mutex<VecDeque<String>>>;

/// Resolve and start the server, then watch it. `Ok` carries the URL to load.
pub fn start(
    app: &AppHandle,
    shared: &Arc<Shared>,
    origin: &Arc<Mutex<Option<Url>>>,
    report: Reporter<'_>,
) -> Result<String, String> {
    if let Some(url) = env_nonempty("PI_WEB_DESKTOP_SERVER_URL") {
        return attach(&url, origin, report);
    }
    // A debug build attaches to the development server unless the caller asks for
    // the packaged payload, so `desktop:dev` never starts a second server.
    if cfg!(debug_assertions) && !env_truthy("PI_WEB_DESKTOP_SPAWN") {
        return attach(&format!("http://127.0.0.1:{DEFAULT_PORT}"), origin, report);
    }

    report("Preparing the Pi Web server\u{2026}", false);
    let payload = payload::prepare(app, report)?;
    let node = node_locator::resolve(app, report)?;
    report(
        &format!("Using Node.js {} at {}.", node.version, node.path.display()),
        false,
    );

    // A server this machine already runs is adopted and left running.
    if let Some(url) = find_recorded_server(agent_dir(), &payload.version) {
        report(&format!("Using the running Pi Web server at {url}."), false);
        return set_origin(origin, &url).map(|_| url);
    }

    let settings = config::read(app);
    let preferred = settings
        .port
        .filter(|port| *port > 0)
        .unwrap_or(DEFAULT_PORT);
    let port = choose_port(preferred, report)?;
    let url = format!("http://127.0.0.1:{port}");
    report(
        &format!("Starting the server on port {port}\u{2026}"),
        false,
    );

    let mut child = spawn(&node.path, &payload.dir, port)?;
    let lines = attach_log(&mut child, app.path().app_log_dir().ok());
    shared.put_server(Server { child: Some(child) });

    let parsed = Url::parse(&url).map_err(|error| format!("Invalid server URL {url}: {error}"))?;
    let deadline = Instant::now() + STARTUP_TIMEOUT;
    loop {
        if shared.is_shutting_down() {
            return Err("Startup was cancelled.".to_string());
        }
        if let Some(status) = shared.poll_exit() {
            return Err(format!(
                "The Pi Web server exited during startup ({status}).{}",
                tail(&lines)
            ));
        }
        if matches!(http_probe::probe(&parsed, Duration::from_secs(2)), Some(code) if (200..400).contains(&code))
        {
            break;
        }
        if Instant::now() >= deadline {
            return Err(format!(
                "The Pi Web server did not answer at {url} within {} seconds.{}",
                STARTUP_TIMEOUT.as_secs(),
                tail(&lines)
            ));
        }
        std::thread::sleep(Duration::from_millis(250));
    }

    set_origin(origin, &url)?;
    let watcher_app = app.clone();
    let watcher_shared = shared.clone();
    std::thread::Builder::new()
        .name("pi-web-watchdog".into())
        .spawn(move || watch(&watcher_app, &watcher_shared))
        .map_err(|error| format!("Could not watch the server: {error}"))?;
    Ok(url)
}

fn attach(
    url: &str,
    origin: &Arc<Mutex<Option<Url>>>,
    report: Reporter<'_>,
) -> Result<String, String> {
    let parsed = Url::parse(url).map_err(|error| format!("{url} is not a server URL: {error}"))?;
    report(
        &format!("Waiting for the Pi Web server at {url}\u{2026}"),
        false,
    );
    let deadline = Instant::now() + ATTACH_TIMEOUT;
    loop {
        if matches!(http_probe::probe(&parsed, Duration::from_secs(2)), Some(code) if (200..400).contains(&code))
        {
            break;
        }
        if Instant::now() >= deadline {
            return Err(format!(
                "Nothing answered at {url}.\n\nStart the development server with `bun run dev`, or run `bun run desktop:build` for a self-contained app."
            ));
        }
        std::thread::sleep(Duration::from_millis(250));
    }
    set_origin(origin, url)?;
    Ok(url.to_string())
}

fn set_origin(origin: &Arc<Mutex<Option<Url>>>, url: &str) -> Result<(), String> {
    let parsed = Url::parse(url).map_err(|error| format!("Invalid server URL {url}: {error}"))?;
    *origin.lock().unwrap_or_else(|error| error.into_inner()) = Some(parsed);
    Ok(())
}

fn watch(app: &AppHandle, shared: &Arc<Shared>) {
    loop {
        if shared.is_shutting_down() {
            return;
        }
        if let Some(status) = shared.poll_exit() {
            // The child is already reaped; take it so shutdown stays idempotent.
            shared.take_server();
            crate::window::set_status(
                app,
                &format!(
                    "The Pi Web server stopped ({status}).\n\nRestart the app to start it again."
                ),
                true,
            );
            return;
        }
        std::thread::sleep(Duration::from_millis(1000));
    }
}

pub fn port_candidates(preferred: u16, attempts: u16) -> Vec<u16> {
    (0..attempts)
        .filter_map(|offset| preferred.checked_add(offset))
        .collect()
}

fn choose_port(preferred: u16, report: Reporter<'_>) -> Result<u16, String> {
    for port in port_candidates(preferred, PORT_ATTEMPTS) {
        if http_probe::port_available(port) {
            return Ok(port);
        }
        report(
            &format!("Port {port} is in use; trying the next one."),
            false,
        );
    }
    http_probe::ephemeral_port().ok_or_else(|| "No free loopback port is available.".to_string())
}

fn spawn(node: &Path, dir: &Path, port: u16) -> Result<Child, String> {
    let mut command = Command::new(node);
    command
        .arg("bin/pi-web.js")
        .arg("--no-open")
        .arg("-H")
        .arg("127.0.0.1")
        .arg("-p")
        .arg(port.to_string())
        .current_dir(dir)
        .env("PI_WEB_HOSTNAME", "127.0.0.1")
        .env("PI_WEB_NO_OPEN", "1")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    node_locator::quiet(&mut command);
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        // Own process group, so stopping the server also stops Next.js.
        command.process_group(0);
    }
    command
        .spawn()
        .map_err(|error| format!("Could not start {}: {error}", node.display()))
}

/// Keep the tail of the server output for failure messages and a log file.
fn attach_log(child: &mut Child, log_dir: Option<PathBuf>) -> LogLines {
    let lines: LogLines = Arc::new(Mutex::new(VecDeque::with_capacity(LOG_LINES)));
    let file = log_dir.and_then(|dir| {
        fs::create_dir_all(&dir).ok()?;
        OpenOptions::new()
            .create(true)
            .append(true)
            .open(dir.join("pi-web-desktop.log"))
            .ok()
    });
    let file = Arc::new(Mutex::new(file));

    for pipe in [
        child
            .stdout
            .take()
            .map(|pipe| Box::new(pipe) as Box<dyn std::io::Read + Send>),
        child
            .stderr
            .take()
            .map(|pipe| Box::new(pipe) as Box<dyn std::io::Read + Send>),
    ]
    .into_iter()
    .flatten()
    {
        let lines = lines.clone();
        let file = file.clone();
        std::thread::spawn(move || {
            let mut reader = BufReader::new(pipe);
            let mut buffer = String::new();
            loop {
                buffer.clear();
                match reader.read_line(&mut buffer) {
                    Ok(0) => return,
                    Ok(_) => {
                        let line = buffer.trim_end().to_string();
                        #[cfg(debug_assertions)]
                        eprintln!("[server] {line}");
                        if let Ok(mut guard) = file.lock() {
                            if let Some(file) = guard.as_mut() {
                                let _ = writeln!(file, "{line}");
                            }
                        }
                        if let Ok(mut guard) = lines.lock() {
                            if guard.len() == LOG_LINES {
                                guard.pop_front();
                            }
                            guard.push_back(line);
                        }
                    }
                    Err(_) => return,
                }
            }
        });
    }
    lines
}

fn tail(lines: &LogLines) -> String {
    let guard = lines.lock().unwrap_or_else(|error| error.into_inner());
    if guard.is_empty() {
        return String::new();
    }
    let start = guard.len().saturating_sub(30);
    let text = guard
        .iter()
        .skip(start)
        .cloned()
        .collect::<Vec<_>>()
        .join("\n");
    format!("\n\nRecent server output:\n{text}")
}

fn stop_process_tree(child: &mut Child) {
    if matches!(child.try_wait(), Ok(Some(_))) {
        return;
    }

    #[cfg(unix)]
    {
        let pid = child.id() as i32;
        // The launcher forwards the signal to Next.js and waits for extensions.
        unsafe {
            libc::kill(-pid, libc::SIGTERM);
        }
        let deadline = Instant::now() + Duration::from_secs(8);
        while Instant::now() < deadline {
            if matches!(child.try_wait(), Ok(Some(_))) {
                break;
            }
            std::thread::sleep(Duration::from_millis(100));
        }
        // Reap anything the launcher left behind, and force the launcher itself.
        unsafe {
            libc::kill(-pid, libc::SIGKILL);
        }
        let _ = child.wait();
    }

    #[cfg(windows)]
    {
        let pid = child.id();
        let mut command = Command::new("taskkill");
        command
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        node_locator::quiet(&mut command);
        let _ = command.status();
        let _ = child.wait();
    }
}

#[derive(Debug, Deserialize)]
struct RunRecord {
    url: Option<String>,
    version: Option<String>,
}

/// Adopt a server recorded by the launcher when it runs the same payload version.
fn find_recorded_server(agent_dir: PathBuf, version: &str) -> Option<String> {
    let entries = fs::read_dir(agent_dir.join("pi-web-run")).ok()?;
    let mut candidates: Vec<RunRecord> = entries
        .flatten()
        .filter(|entry| entry.path().extension().is_some_and(|ext| ext == "json"))
        .filter_map(|entry| {
            let text = fs::read_to_string(entry.path()).ok()?;
            serde_json::from_str(&text).ok()
        })
        .filter(|record: &RunRecord| record.version.as_deref() == Some(version))
        .collect();
    candidates.sort_by_key(|record| record.url.clone());

    for record in candidates {
        let Some(url) = record.url else { continue };
        let Ok(parsed) = Url::parse(&url) else {
            continue;
        };
        if matches!(http_probe::probe(&parsed, Duration::from_secs(2)), Some(code) if (200..400).contains(&code))
        {
            return Some(url);
        }
    }
    None
}

/// Mirror `getAgentDir()` in `bin/run-records.js`.
fn agent_dir() -> PathBuf {
    let home = std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
        .unwrap_or_default();
    let Some(configured) = std::env::var_os("PI_CODING_AGENT_DIR") else {
        return home.join(".pi").join("agent");
    };
    let path = PathBuf::from(configured);
    let text = path.to_string_lossy().to_string();
    if text == "~" {
        home
    } else if let Some(rest) = text.strip_prefix("~/").or_else(|| text.strip_prefix("~\\")) {
        home.join(rest)
    } else {
        path
    }
}

fn env_nonempty(name: &str) -> Option<String> {
    std::env::var(name)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn env_truthy(name: &str) -> bool {
    matches!(
        env_nonempty(name)
            .map(|value| value.to_ascii_lowercase())
            .as_deref(),
        Some("1" | "true" | "yes" | "on")
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tries_the_preferred_port_first_and_never_wraps() {
        assert_eq!(port_candidates(30141, 3), vec![30141, 30142, 30143]);
        assert_eq!(port_candidates(u16::MAX, 3), vec![u16::MAX]);
    }

    #[cfg(unix)]
    #[test]
    fn stops_the_whole_process_group() {
        use std::os::unix::process::CommandExt;

        let dir = std::env::temp_dir().join(format!("pi-web-stop-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let marker = dir.join("child.pid");

        // A launcher-shaped parent with one background child in the same group.
        let mut command = Command::new("sh");
        command
            .arg("-c")
            .arg(format!("sleep 30 & echo $! > {} ; wait", marker.display()))
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        command.process_group(0);
        let mut child = command.spawn().unwrap();

        let deadline = Instant::now() + Duration::from_secs(5);
        while !marker.exists() && Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(20));
        }
        let grandchild: i32 = std::fs::read_to_string(&marker)
            .unwrap()
            .trim()
            .parse()
            .unwrap();

        stop_process_tree(&mut child);

        assert!(matches!(child.try_wait(), Ok(Some(_))));
        // ESRCH: the background child is gone too, not just the group leader.
        assert_eq!(unsafe { libc::kill(grandchild, 0) }, -1);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn reads_run_records_without_a_version() {
        let record: RunRecord =
            serde_json::from_str(r#"{"url":"http://127.0.0.1:30141"}"#).unwrap();
        assert_eq!(record.version, None);
        assert_eq!(record.url.as_deref(), Some("http://127.0.0.1:30141"));
    }

    #[test]
    fn a_missing_record_directory_is_not_an_error() {
        let dir = std::env::temp_dir().join(format!("pi-web-missing-{}", std::process::id()));
        assert_eq!(find_recorded_server(dir, "0.1.0"), None);
    }
}
