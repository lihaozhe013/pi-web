//! Minimal HTTP readiness check. The shell only needs the status code of a
//! loopback request, so this speaks just enough HTTP/1.1 to avoid a TLS stack and
//! a large client dependency in the binary.

use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream, ToSocketAddrs};
use std::time::Duration;
use tauri::Url;

pub fn parse_status(bytes: &[u8]) -> Option<u16> {
    let text = std::str::from_utf8(bytes).ok()?;
    let line = text.lines().next()?;
    let mut parts = line.split_whitespace();
    let version = parts.next()?;
    if !version.starts_with("HTTP/") {
        return None;
    }
    parts.next()?.parse().ok()
}

/// Status code of `GET url`, or `None` when nothing answered.
pub fn probe(url: &Url, timeout: Duration) -> Option<u16> {
    if url.scheme() != "http" {
        return None;
    }
    let host = url.host_str()?;
    let port = url.port_or_known_default()?;
    let address = (host, port).to_socket_addrs().ok()?.next()?;
    let mut stream = TcpStream::connect_timeout(&address, timeout).ok()?;
    stream.set_read_timeout(Some(timeout)).ok()?;
    stream.set_write_timeout(Some(timeout)).ok()?;

    let path = if url.path().is_empty() {
        "/"
    } else {
        url.path()
    };
    let path = match url.query() {
        Some(query) => format!("{path}?{query}"),
        None => path.to_string(),
    };
    let authority = match url.port() {
        Some(port) => format!("{host}:{port}"),
        None => host.to_string(),
    };
    let request = format!(
        "GET {path} HTTP/1.1\r\nHost: {authority}\r\nUser-Agent: pi-web-desktop\r\nAccept: */*\r\nConnection: close\r\n\r\n"
    );
    stream.write_all(request.as_bytes()).ok()?;

    let mut buffer = [0u8; 512];
    let mut filled = 0;
    while filled < buffer.len() {
        match stream.read(&mut buffer[filled..]) {
            Ok(0) => break,
            Ok(count) => {
                filled += count;
                if buffer[..filled]
                    .windows(4)
                    .any(|window| window == b"\r\n\r\n")
                {
                    break;
                }
            }
            Err(_) => break,
        }
    }
    parse_status(&buffer[..filled])
}

/// Whether the shell could bind the loopback port itself.
pub fn port_available(port: u16) -> bool {
    TcpListener::bind(("127.0.0.1", port)).is_ok()
}

/// An OS-assigned loopback port, released before the server binds it.
pub fn ephemeral_port() -> Option<u16> {
    let listener = TcpListener::bind(("127.0.0.1", 0)).ok()?;
    listener.local_addr().ok().map(|address| address.port())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_status_code_from_a_response_head() {
        assert_eq!(
            parse_status(b"HTTP/1.1 200 OK\r\nContent-Length: 0\r\n\r\n"),
            Some(200)
        );
        assert_eq!(
            parse_status(b"HTTP/1.1 401 Unauthorized\r\n\r\n"),
            Some(401)
        );
        assert_eq!(parse_status(b"HTTP/1.1 503 Service Unavailable"), Some(503));
    }

    #[test]
    fn rejects_anything_that_is_not_an_http_status_line() {
        assert_eq!(parse_status(b""), None);
        assert_eq!(parse_status(b"OK 200\r\n"), None);
        assert_eq!(parse_status(b"HTTP/1.1 banana\r\n"), None);
        assert_eq!(parse_status(b"\x00\x01\x02"), None);
    }

    #[test]
    fn only_binds_loopback_ports() {
        let port = ephemeral_port().expect("an ephemeral port");
        assert!(port > 0);
        assert!(port_available(port));
    }
}
