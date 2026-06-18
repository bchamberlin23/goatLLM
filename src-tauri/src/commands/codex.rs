use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::fs;
use std::io::{Read, Write};
use std::net::TcpListener;
use std::path::PathBuf;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::{Emitter, Manager};
use url::Url;

const CLIENT_ID: &str = "app_EMoamEEZ73f0CkXaXp7hrann";
const AUTHORIZE_URL: &str = "https://auth.openai.com/oauth/authorize";
const TOKEN_URL: &str = "https://auth.openai.com/oauth/token";
const REDIRECT_URI: &str = "http://localhost:1455/auth/callback";
const SCOPE: &str = "openid profile email offline_access";
const CODEX_BASE_URL: &str = "https://chatgpt.com/backend-api";
const JWT_CLAIM_PATH: &str = "https://api.openai.com/auth";
const ORIGINATOR: &str = "goatllm";
const LOGIN_TIMEOUT: Duration = Duration::from_secs(10 * 60);

#[derive(Clone)]
pub struct CodexProviderState {
    pending_logins: Arc<Mutex<HashMap<String, PendingLogin>>>,
    running_streams: Arc<Mutex<HashMap<String, Arc<AtomicBool>>>>,
}

impl CodexProviderState {
    pub fn new() -> Self {
        Self {
            pending_logins: Arc::new(Mutex::new(HashMap::new())),
            running_streams: Arc::new(Mutex::new(HashMap::new())),
        }
    }
}

#[derive(Clone)]
struct PendingLogin {
    state: String,
    verifier: String,
    created_at: Instant,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct CodexCredentials {
    access: String,
    refresh: String,
    expires: u64,
    account_id: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct CodexAuthStatus {
    signed_in: bool,
    account_id: Option<String>,
    expires: Option<u64>,
}

#[derive(Debug, Clone, Serialize)]
pub struct CodexOAuthStart {
    login_id: String,
    auth_url: String,
    redirect_uri: String,
    callback_server: bool,
}

#[derive(Debug, Clone)]
struct ParsedOAuthInput {
    code: String,
    state: Option<String>,
}

#[tauri::command]
pub fn openai_codex_auth_status(app: tauri::AppHandle) -> Result<CodexAuthStatus, String> {
    let creds = load_credentials(&app)?;
    Ok(status_from_credentials(creds.as_ref()))
}

#[tauri::command]
pub fn openai_codex_oauth_start(
    app: tauri::AppHandle,
    state: tauri::State<'_, CodexProviderState>,
) -> Result<CodexOAuthStart, String> {
    let login_id = new_id();
    let verifier = random_base64url(32);
    let oauth_state = random_hex(16);
    let challenge = pkce_challenge_for_verifier(&verifier);
    let auth_url = build_authorize_url(&oauth_state, &challenge)?;

    let pending = PendingLogin {
        state: oauth_state.clone(),
        verifier: verifier.clone(),
        created_at: Instant::now(),
    };
    state
        .pending_logins
        .lock()
        .map_err(|_| "Cannot lock Codex login state".to_string())?
        .insert(login_id.clone(), pending.clone());

    let callback_server = start_callback_server(
        app,
        state.pending_logins.clone(),
        login_id.clone(),
        pending,
    );

    Ok(CodexOAuthStart {
        login_id,
        auth_url,
        redirect_uri: REDIRECT_URI.to_string(),
        callback_server,
    })
}

#[tauri::command]
pub fn openai_codex_oauth_complete(
    app: tauri::AppHandle,
    state: tauri::State<'_, CodexProviderState>,
    login_id: String,
    input: String,
) -> Result<CodexAuthStatus, String> {
    let pending = {
        let map = state
            .pending_logins
            .lock()
            .map_err(|_| "Cannot lock Codex login state".to_string())?;
        map.get(&login_id).cloned()
    }
    .ok_or_else(|| "This OpenAI Codex login is no longer pending.".to_string())?;

    let parsed = parse_oauth_callback_input(&input)?;
    validate_oauth_state(&pending, parsed.state.as_deref())?;
    let creds = exchange_authorization_code(&parsed.code, &pending.verifier)?;
    save_credentials(&app, &creds)?;
    let _ = state
        .pending_logins
        .lock()
        .map_err(|_| "Cannot lock Codex login state".to_string())?
        .remove(&login_id);
    Ok(status_from_credentials(Some(&creds)))
}

#[tauri::command]
pub fn openai_codex_logout(app: tauri::AppHandle) -> Result<CodexAuthStatus, String> {
    let path = credentials_path(&app)?;
    if path.exists() {
        fs::remove_file(&path)
            .map_err(|e| format!("Cannot remove OpenAI Codex credentials: {}", e))?;
    }
    Ok(status_from_credentials(None))
}

#[tauri::command]
pub async fn openai_codex_stream(
    app: tauri::AppHandle,
    state: tauri::State<'_, CodexProviderState>,
    run_id: String,
    body: Value,
    session_id: Option<String>,
    base_url: Option<String>,
) -> Result<(), String> {
    let cancel = Arc::new(AtomicBool::new(false));
    state
        .running_streams
        .lock()
        .map_err(|_| "Cannot lock Codex stream state".to_string())?
        .insert(run_id.clone(), cancel.clone());

    let streams = state.running_streams.clone();
    let run_id_for_cleanup = run_id.clone();
    let result = tokio::task::spawn_blocking(move || {
        stream_codex_responses(app, run_id, body, session_id, base_url, cancel)
    })
    .await
    .map_err(|e| format!("OpenAI Codex stream task failed: {}", e))?;

    let _ = streams
        .lock()
        .map_err(|_| "Cannot lock Codex stream state".to_string())?
        .remove(&run_id_for_cleanup);

    result
}

#[tauri::command]
pub fn openai_codex_cancel(
    state: tauri::State<'_, CodexProviderState>,
    run_id: String,
) -> Result<(), String> {
    if let Some(cancel) = state
        .running_streams
        .lock()
        .map_err(|_| "Cannot lock Codex stream state".to_string())?
        .remove(&run_id)
    {
        cancel.store(true, Ordering::SeqCst);
    }
    Ok(())
}

fn stream_codex_responses(
    app: tauri::AppHandle,
    run_id: String,
    body: Value,
    session_id: Option<String>,
    base_url: Option<String>,
    cancel: Arc<AtomicBool>,
) -> Result<(), String> {
    let creds = fresh_credentials(&app)?;
    let url = resolve_codex_url(base_url.as_deref());
    let client = reqwest::blocking::Client::new();
    let body_json = serde_json::to_string(&body)
        .map_err(|e| format!("Cannot serialize OpenAI Codex request: {}", e))?;
    let mut req = client
        .post(url)
        .bearer_auth(&creds.access)
        .header("chatgpt-account-id", &creds.account_id)
        .header("originator", ORIGINATOR)
        .header("User-Agent", "goatLLM")
        .header("OpenAI-Beta", "responses=experimental")
        .header("accept", "text/event-stream")
        .header("content-type", "application/json")
        .body(body_json);

    if let Some(session) = session_id.as_deref().filter(|s| !s.is_empty()) {
        req = req
            .header("session_id", session)
            .header("x-client-request-id", session);
    }

    let mut response = req
        .send()
        .map_err(|e| format!("OpenAI Codex request failed: {}", e))?;

    if !response.status().is_success() {
        let status = response.status().as_u16();
        let text = response.text().unwrap_or_else(|_| "".to_string());
        let message = friendly_codex_error(status, &text);
        emit_stream_error(&app, &run_id, &message);
        return Err(message);
    }

    let mut bytes = [0_u8; 8192];
    let mut buffer = String::new();
    loop {
        if cancel.load(Ordering::SeqCst) {
            emit_stream_done(&app, &run_id, true);
            return Ok(());
        }

        let read = response
            .read(&mut bytes)
            .map_err(|e| format!("OpenAI Codex stream read failed: {}", e))?;
        if read == 0 {
            break;
        }
        buffer.push_str(&String::from_utf8_lossy(&bytes[..read]));
        buffer = buffer.replace("\r\n", "\n");

        while let Some(idx) = buffer.find("\n\n") {
            let frame = buffer[..idx].to_string();
            buffer = buffer[idx + 2..].to_string();
            handle_sse_frame(&app, &run_id, &frame)?;
        }
    }

    if !buffer.trim().is_empty() {
        handle_sse_frame(&app, &run_id, &buffer)?;
    }
    emit_stream_done(&app, &run_id, false);
    Ok(())
}

fn handle_sse_frame(app: &tauri::AppHandle, run_id: &str, frame: &str) -> Result<(), String> {
    let data = frame
        .lines()
        .filter_map(|line| line.strip_prefix("data:"))
        .map(str::trim)
        .collect::<Vec<_>>()
        .join("\n");

    if data.trim().is_empty() || data.trim() == "[DONE]" {
        return Ok(());
    }

    let event: Value = serde_json::from_str(&data)
        .map_err(|e| format!("OpenAI Codex sent invalid SSE JSON: {}", e))?;
    let _ = app.emit(
        &format!("openai-codex-stream:{}", run_id),
        serde_json::json!({ "kind": "event", "event": event }),
    );
    Ok(())
}

fn emit_stream_error(app: &tauri::AppHandle, run_id: &str, message: &str) {
    let _ = app.emit(
        &format!("openai-codex-stream:{}", run_id),
        serde_json::json!({ "kind": "error", "message": message }),
    );
}

fn emit_stream_done(app: &tauri::AppHandle, run_id: &str, cancelled: bool) {
    let _ = app.emit(
        &format!("openai-codex-stream:{}", run_id),
        serde_json::json!({ "kind": "done", "cancelled": cancelled }),
    );
}

fn start_callback_server(
    app: tauri::AppHandle,
    pending_logins: Arc<Mutex<HashMap<String, PendingLogin>>>,
    login_id: String,
    pending: PendingLogin,
) -> bool {
    let listener = match TcpListener::bind("127.0.0.1:1455") {
        Ok(listener) => listener,
        Err(_) => return false,
    };
    if listener.set_nonblocking(true).is_err() {
        return false;
    }

    thread::spawn(move || {
        let started = Instant::now();
        while started.elapsed() < LOGIN_TIMEOUT {
            match listener.accept() {
                Ok((mut stream, _addr)) => {
                    let mut buffer = [0_u8; 8192];
                    let read = stream.read(&mut buffer).unwrap_or(0);
                    let request = String::from_utf8_lossy(&buffer[..read]);
                    let result = parse_http_callback_request(&request)
                        .and_then(|parsed| {
                            validate_oauth_state(&pending, parsed.state.as_deref())?;
                            exchange_authorization_code(&parsed.code, &pending.verifier)
                        })
                        .and_then(|creds| {
                            save_credentials(&app, &creds)?;
                            Ok(status_from_credentials(Some(&creds)))
                        });

                    match result {
                        Ok(status) => {
                            let _ = write_oauth_http_response(&mut stream, true);
                            let _ = pending_logins.lock().map(|mut map| map.remove(&login_id));
                            let _ = app.emit(
                                &format!("openai-codex-oauth:{}", login_id),
                                serde_json::json!({ "kind": "signed_in", "status": status }),
                            );
                        }
                        Err(message) => {
                            let _ = write_oauth_http_response(&mut stream, false);
                            let _ = app.emit(
                                &format!("openai-codex-oauth:{}", login_id),
                                serde_json::json!({ "kind": "error", "message": message }),
                            );
                        }
                    }
                    return;
                }
                Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                    thread::sleep(Duration::from_millis(100));
                }
                Err(_) => return,
            }
        }
    });

    true
}

fn write_oauth_http_response(stream: &mut std::net::TcpStream, ok: bool) -> std::io::Result<()> {
    let (status, title, body) = if ok {
        (
            "200 OK",
            "OpenAI authentication complete",
            "You can close this window and return to goatLLM.",
        )
    } else {
        (
            "400 Bad Request",
            "OpenAI authentication failed",
            "Return to goatLLM and try signing in again.",
        )
    };
    let html = format!(
        "<!doctype html><html><head><title>{}</title></head><body><h1>{}</h1><p>{}</p></body></html>",
        title, title, body
    );
    write!(
        stream,
        "HTTP/1.1 {}\r\ncontent-type: text/html; charset=utf-8\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{}",
        status,
        html.len(),
        html
    )
}

fn parse_http_callback_request(request: &str) -> Result<ParsedOAuthInput, String> {
    let first_line = request
        .lines()
        .next()
        .ok_or_else(|| "Missing OAuth callback request line".to_string())?;
    let mut parts = first_line.split_whitespace();
    let method = parts.next().unwrap_or("");
    let target = parts.next().unwrap_or("");
    if method != "GET" || target.is_empty() {
        return Err("Invalid OAuth callback request".to_string());
    }
    parse_oauth_callback_input(&format!("http://localhost{}", target))
}

fn parse_oauth_callback_input(input: &str) -> Result<ParsedOAuthInput, String> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return Err("Missing authorization code".to_string());
    }

    if let Ok(url) = Url::parse(trimmed) {
        let code = url
            .query_pairs()
            .find(|(key, _)| key == "code")
            .map(|(_, value)| value.to_string())
            .filter(|value| !value.is_empty())
            .ok_or_else(|| "OAuth callback URL did not include a code".to_string())?;
        let state = url
            .query_pairs()
            .find(|(key, _)| key == "state")
            .map(|(_, value)| value.to_string())
            .filter(|value| !value.is_empty());
        return Ok(ParsedOAuthInput { code, state });
    }

    if trimmed.contains("code=") {
        let url = Url::parse(&format!("http://localhost/auth/callback?{}", trimmed))
            .map_err(|e| format!("Invalid OAuth callback input: {}", e))?;
        return parse_oauth_callback_input(url.as_str());
    }

    if let Some((code, state)) = trimmed.split_once('#') {
        return Ok(ParsedOAuthInput {
            code: code.to_string(),
            state: if state.is_empty() { None } else { Some(state.to_string()) },
        });
    }

    Ok(ParsedOAuthInput {
        code: trimmed.to_string(),
        state: None,
    })
}

fn validate_oauth_state(pending: &PendingLogin, state: Option<&str>) -> Result<(), String> {
    if pending.created_at.elapsed() > LOGIN_TIMEOUT {
        return Err("OpenAI Codex login expired. Start a new sign-in.".to_string());
    }
    if let Some(state) = state {
        if state != pending.state {
            return Err("OpenAI Codex login state mismatch.".to_string());
        }
    }
    Ok(())
}

fn build_authorize_url(state: &str, challenge: &str) -> Result<String, String> {
    let mut url = Url::parse(AUTHORIZE_URL).map_err(|e| e.to_string())?;
    url.query_pairs_mut()
        .append_pair("response_type", "code")
        .append_pair("client_id", CLIENT_ID)
        .append_pair("redirect_uri", REDIRECT_URI)
        .append_pair("scope", SCOPE)
        .append_pair("code_challenge", challenge)
        .append_pair("code_challenge_method", "S256")
        .append_pair("state", state)
        .append_pair("id_token_add_organizations", "true")
        .append_pair("codex_cli_simplified_flow", "true")
        .append_pair("originator", ORIGINATOR);
    Ok(url.to_string())
}

fn exchange_authorization_code(code: &str, verifier: &str) -> Result<CodexCredentials, String> {
    let client = reqwest::blocking::Client::new();
    let response = client
        .post(TOKEN_URL)
        .header("content-type", "application/x-www-form-urlencoded")
        .form(&[
            ("grant_type", "authorization_code"),
            ("client_id", CLIENT_ID),
            ("code", code),
            ("code_verifier", verifier),
            ("redirect_uri", REDIRECT_URI),
        ])
        .send()
        .map_err(|e| format!("OpenAI Codex token exchange failed: {}", e))?;

    parse_token_response(response, None, "exchange")
}

fn refresh_credentials(refresh_token: &str) -> Result<CodexCredentials, String> {
    let client = reqwest::blocking::Client::new();
    let response = client
        .post(TOKEN_URL)
        .header("content-type", "application/x-www-form-urlencoded")
        .form(&[
            ("grant_type", "refresh_token"),
            ("client_id", CLIENT_ID),
            ("refresh_token", refresh_token),
        ])
        .send()
        .map_err(|e| format!("OpenAI Codex token refresh failed: {}", e))?;

    parse_token_response(response, Some(refresh_token), "refresh")
}

fn parse_token_response(
    response: reqwest::blocking::Response,
    fallback_refresh: Option<&str>,
    label: &str,
) -> Result<CodexCredentials, String> {
    let status = response.status();
    let body = response
        .text()
        .map_err(|e| format!("OpenAI Codex token {} returned unreadable body: {}", label, e))?;
    if !status.is_success() {
        return Err(format!(
            "OpenAI Codex token {} failed ({}): {}",
            label, status, body
        ));
    }
    let json: Value = serde_json::from_str(&body)
        .map_err(|e| format!("OpenAI Codex token {} returned invalid JSON: {}", label, e))?;
    let access = json
        .get("access_token")
        .and_then(Value::as_str)
        .ok_or_else(|| format!("OpenAI Codex token {} response missing access_token", label))?
        .to_string();
    let refresh = json
        .get("refresh_token")
        .and_then(Value::as_str)
        .or(fallback_refresh)
        .ok_or_else(|| format!("OpenAI Codex token {} response missing refresh_token", label))?
        .to_string();
    let expires_in = json
        .get("expires_in")
        .and_then(Value::as_u64)
        .ok_or_else(|| format!("OpenAI Codex token {} response missing expires_in", label))?;
    let account_id = extract_account_id_from_access_token(&access)?;
    Ok(CodexCredentials {
        access,
        refresh,
        expires: now_ms() + expires_in.saturating_mul(1000),
        account_id,
    })
}

fn fresh_credentials(app: &tauri::AppHandle) -> Result<CodexCredentials, String> {
    let creds = load_credentials(app)?
        .ok_or_else(|| "Sign in to OpenAI Codex in Settings before using this model.".to_string())?;
    if now_ms().saturating_add(60_000) < creds.expires {
        return Ok(creds);
    }
    let refreshed = refresh_credentials(&creds.refresh)?;
    save_credentials(app, &refreshed)?;
    Ok(refreshed)
}

fn load_credentials(app: &tauri::AppHandle) -> Result<Option<CodexCredentials>, String> {
    let path = credentials_path(app)?;
    if !path.exists() {
        return Ok(None);
    }
    let raw = fs::read_to_string(&path)
        .map_err(|e| format!("Cannot read OpenAI Codex credentials: {}", e))?;
    let creds = serde_json::from_str(&raw)
        .map_err(|e| format!("Cannot parse OpenAI Codex credentials: {}", e))?;
    Ok(Some(creds))
}

fn save_credentials(app: &tauri::AppHandle, creds: &CodexCredentials) -> Result<(), String> {
    let path = credentials_path(app)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Cannot create OpenAI Codex credential directory: {}", e))?;
    }
    let raw = serde_json::to_string_pretty(creds)
        .map_err(|e| format!("Cannot serialize OpenAI Codex credentials: {}", e))?;
    fs::write(&path, raw).map_err(|e| format!("Cannot write OpenAI Codex credentials: {}", e))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let permissions = fs::Permissions::from_mode(0o600);
        let _ = fs::set_permissions(&path, permissions);
    }
    Ok(())
}

fn credentials_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Cannot determine app data directory: {}", e))?;
    Ok(dir.join("openai-codex-auth.json"))
}

fn status_from_credentials(creds: Option<&CodexCredentials>) -> CodexAuthStatus {
    match creds {
        Some(creds) => CodexAuthStatus {
            signed_in: true,
            account_id: Some(creds.account_id.clone()),
            expires: Some(creds.expires),
        },
        None => CodexAuthStatus {
            signed_in: false,
            account_id: None,
            expires: None,
        },
    }
}

fn pkce_challenge_for_verifier(verifier: &str) -> String {
    let hash = Sha256::digest(verifier.as_bytes());
    URL_SAFE_NO_PAD.encode(hash)
}

fn extract_account_id_from_access_token(token: &str) -> Result<String, String> {
    let payload = token
        .split('.')
        .nth(1)
        .ok_or_else(|| "Invalid OpenAI Codex access token".to_string())?;
    let decoded = URL_SAFE_NO_PAD
        .decode(payload)
        .map_err(|_| "Invalid OpenAI Codex access token payload".to_string())?;
    let json: Value = serde_json::from_slice(&decoded)
        .map_err(|_| "Invalid OpenAI Codex access token JSON".to_string())?;
    json.get(JWT_CLAIM_PATH)
        .and_then(|auth| auth.get("chatgpt_account_id"))
        .and_then(Value::as_str)
        .map(str::to_string)
        .filter(|id| !id.is_empty())
        .ok_or_else(|| "Failed to extract ChatGPT account id from OpenAI token".to_string())
}

fn resolve_codex_url(base_url: Option<&str>) -> String {
    let raw = base_url
        .filter(|url| !url.trim().is_empty())
        .unwrap_or(CODEX_BASE_URL)
        .trim()
        .trim_end_matches('/');
    if raw.ends_with("/codex/responses") {
        raw.to_string()
    } else if raw.ends_with("/codex") {
        format!("{}/responses", raw)
    } else {
        format!("{}/codex/responses", raw)
    }
}

fn friendly_codex_error(status: u16, body: &str) -> String {
    if let Ok(json) = serde_json::from_str::<Value>(body) {
        if let Some(error) = json.get("error") {
            let code = error.get("code").and_then(Value::as_str).unwrap_or("");
            if status == 429 || code.contains("usage_limit") || code.contains("rate_limit") {
                return "You have hit your ChatGPT Codex usage limit. Try again later.".to_string();
            }
            if let Some(message) = error.get("message").and_then(Value::as_str) {
                return message.to_string();
            }
        }
    }
    if status == 401 || status == 403 {
        return "OpenAI Codex authentication failed. Sign in again from Settings.".to_string();
    }
    format!("OpenAI Codex request failed ({}): {}", status, body)
}

fn random_base64url(bytes: usize) -> String {
    let mut buf = vec![0_u8; bytes];
    rand::thread_rng().fill_bytes(&mut buf);
    URL_SAFE_NO_PAD.encode(buf)
}

fn random_hex(bytes: usize) -> String {
    let mut buf = vec![0_u8; bytes];
    rand::thread_rng().fill_bytes(&mut buf);
    buf.iter().map(|b| format!("{:02x}", b)).collect()
}

fn new_id() -> String {
    uuid::Uuid::new_v4().to_string()
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pkce_challenge_matches_rfc_vector() {
        let verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
        assert_eq!(
            pkce_challenge_for_verifier(verifier),
            "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
        );
    }

    #[test]
    fn parses_oauth_callback_url_or_raw_code() {
        let parsed = parse_oauth_callback_input(
            "http://localhost:1455/auth/callback?code=code_123&state=state_456",
        )
        .unwrap();
        assert_eq!(parsed.code, "code_123");
        assert_eq!(parsed.state.as_deref(), Some("state_456"));

        let parsed = parse_oauth_callback_input("manual_code").unwrap();
        assert_eq!(parsed.code, "manual_code");
        assert_eq!(parsed.state, None);
    }

    #[test]
    fn extracts_chatgpt_account_id_from_access_token() {
        let token = concat!(
            "eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.",
            "eyJodHRwczovL2FwaS5vcGVuYWkuY29tL2F1dGgiOnsiY2hhdGdwdF9hY2NvdW50X2lkIjoiYWNjdF8xMjMifX0.",
            "signature"
        );
        assert_eq!(extract_account_id_from_access_token(token).unwrap(), "acct_123");
    }

    #[test]
    fn auth_status_does_not_expose_tokens() {
        let creds = CodexCredentials {
            access: "access_secret".to_string(),
            refresh: "refresh_secret".to_string(),
            expires: 4_102_444_800_000,
            account_id: "acct_123".to_string(),
        };
        let status = status_from_credentials(Some(&creds));
        let json = serde_json::to_string(&status).unwrap();
        assert!(status.signed_in);
        assert_eq!(status.account_id.as_deref(), Some("acct_123"));
        assert!(!json.contains("access_secret"));
        assert!(!json.contains("refresh_secret"));
    }
}
