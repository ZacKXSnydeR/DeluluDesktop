use tauri::Manager;
use std::sync::atomic::Ordering;
use std::path::{Path, PathBuf};

use std::process::Stdio;
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
use serde::{Deserialize, Serialize};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, ChildStdout, Command};

mod proxy;


// CREATE_NO_WINDOW prevents node.exe from flashing a console window.
// Standard for GUI apps spawning helper processes.
#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;
#[cfg(target_os = "windows")]
const DETACHED_PROCESS: u32 = 0x00000008;
#[cfg(target_os = "windows")]
const CREATE_NEW_PROCESS_GROUP: u32 = 0x00000200;

#[derive(Default)]
struct ExtractorSidecarState {
    sidecar: tokio::sync::Mutex<Option<ExtractorSidecar>>,
    browser_executable: tokio::sync::Mutex<Option<PathBuf>>,
}

struct ExtractorSidecar {
    child: Child,
    stdin: ChildStdin,
    stdout: BufReader<ChildStdout>,
    request_counter: u64,
    extractor_dir: PathBuf,
    node_command: String,
    browser_executable: Option<PathBuf>,
}

impl ExtractorSidecar {
    async fn spawn(
        extractor_dir: PathBuf,
        node_command: String,
        browser_executable: Option<PathBuf>,
    ) -> Result<Self, String> {
        let mut command = Command::new(&node_command);
        command
            .arg("stdio-bridge.js")
            .current_dir(&extractor_dir)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null());

        // Strip Windows \\\\?\\ extended-path prefix because Node.js/Puppeteer may fail on it.
        if let Some(exe_path) = &browser_executable {
            let clean = exe_path.to_string_lossy().replace(r"\\?\", "").replace(r"\?\", "");
            command.env("PUPPETEER_EXECUTABLE_PATH", &clean);
        } else {
            command.env(
                "PUPPETEER_BROWSER_CHANNEL",
                std::env::var("PUPPETEER_BROWSER_CHANNEL").unwrap_or_else(|_| "msedge".to_string()),
            );
        }

        #[cfg(target_os = "windows")]
        {
            // Harden child process launch so Node helper never flashes a console window.
            command.creation_flags(CREATE_NO_WINDOW | DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP);
        }

        let mut child = command
            .spawn()
            .map_err(|e| format!("Failed to start extractor sidecar: {e}"))?;

        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| "Failed to open sidecar stdin".to_string())?;

        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| "Failed to open sidecar stdout".to_string())?;

        let mut stdout_reader = BufReader::new(stdout);
        let mut ready_line = String::new();

        let ready_result = tokio::time::timeout(
            std::time::Duration::from_secs(10),
            stdout_reader.read_line(&mut ready_line),
        )
        .await
        .map_err(|_| "Extractor sidecar ready timeout".to_string())?
        .map_err(|e| format!("Failed reading sidecar ready line: {e}"))?;

        if ready_result == 0 {
            return Err("Extractor sidecar exited before ready".to_string());
        }

        if !ready_line.contains("\"type\":\"ready\"") {
            return Err(format!("Unexpected sidecar ready payload: {}", ready_line.trim()));
        }

        Ok(Self {
            child,
            stdin,
            stdout: stdout_reader,
            request_counter: 0,
            extractor_dir,
            node_command,
            browser_executable,
        })
    }

    fn next_request_id(&mut self) -> String {
        self.request_counter = self.request_counter.saturating_add(1);
        format!("req-{}", self.request_counter)
    }

    async fn extract_provider(&mut self, args: &ExtractProviderArgs) -> Result<ExtractProviderResult, String> {
        let req_id = self.next_request_id();

        let payload = serde_json::json!({
            "id": req_id,
            "action": "extract_provider",
            "payload": {
                "mediaType": args.media_type,
                "tmdbId": args.tmdb_id,
                "season": args.season,
                "episode": args.episode,
                "baseUrl": args.base_url,
                "bypassCache": args.bypass_cache.unwrap_or(false)
            }
        });

        let body = payload.to_string();
        self.stdin
            .write_all(body.as_bytes())
            .await
            .map_err(|e| format!("Failed to write extractor request: {e}"))?;
        self.stdin
            .write_all(b"\n")
            .await
            .map_err(|e| format!("Failed to write extractor newline: {e}"))?;
        self.stdin
            .flush()
            .await
            .map_err(|e| format!("Failed to flush extractor request: {e}"))?;

        let req_id_clone = req_id.clone();
        tokio::time::timeout(std::time::Duration::from_secs(90), async {
            loop {
                let mut line = String::new();
                let count = self
                    .stdout
                    .read_line(&mut line)
                    .await
                    .map_err(|e| format!("Failed to read extractor response: {e}"))?;

                if count == 0 {
                    return Err("Extractor sidecar closed stdout".to_string());
                }

                let trimmed = line.trim();
                if trimmed.is_empty() {
                    continue;
                }

                let parsed: serde_json::Value = match serde_json::from_str(trimmed) {
                    Ok(v) => v,
                    Err(_) => continue,
                };

                let response_id = parsed
                    .get("id")
                    .and_then(|v| v.as_str())
                    .unwrap_or_default();

                if response_id != req_id_clone {
                    continue;
                }

                let success = parsed.get("success").and_then(|v| v.as_bool()).unwrap_or(false);
                let stream_url = parsed
                    .get("stream_url")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string())
                    .or_else(|| {
                        parsed
                            .get("streamUrl")
                            .and_then(|v| v.as_str())
                            .map(|s| s.to_string())
                    });

                let headers = parsed.get("headers").cloned();
                let subtitles = parsed.get("subtitles").cloned();
                let error = parsed
                    .get("error")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string())
                    .or_else(|| if success { None } else { Some("Extraction failed".to_string()) });

                return Ok(ExtractProviderResult {
                    success,
                    stream_url,
                    headers,
                    subtitles,
                    error,
                });
            }
        })
        .await
        .map_err(|_| "Extractor response timeout".to_string())?
    }
}

#[tauri::command]
async fn get_proxy_port(state: tauri::State<'_, proxy::ProxyState>) -> Result<u16, String> {
    for _ in 0..50 {
        let port = state.port.load(Ordering::SeqCst);
        if port != 0 {
            return Ok(port);
        }
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
    }
    Err("HLS proxy failed to start".to_string())
}

#[tauri::command]
async fn set_proxy_headers(
    state: tauri::State<'_, proxy::ProxyState>,
    referer: Option<String>,
    origin: Option<String>,
    user_agent: Option<String>,
) -> Result<(), String> {
    let mut headers = state.headers.write().await;
    headers.referer = referer;
    headers.origin = origin;
    headers.user_agent = user_agent;
    println!(
        "[HLS Proxy] Headers set: referer={:?}, origin={:?}",
        headers.referer, headers.origin
    );
    Ok(())
}

#[tauri::command]
async fn clear_proxy_cache(state: tauri::State<'_, proxy::ProxyState>) -> Result<(), String> {
    state.clear_cache().await;
    Ok(())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExtractProviderArgs {
    media_type: String,
    tmdb_id: u32,
    season: Option<u32>,
    episode: Option<u32>,
    base_url: Option<String>,
    bypass_cache: Option<bool>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ExtractProviderResult {
    success: bool,
    stream_url: Option<String>,
    headers: Option<serde_json::Value>,
    subtitles: Option<serde_json::Value>,
    error: Option<String>,
}

fn is_local_extractor_dir(path: &Path) -> bool {
    path.join("cli.js").exists() && path.join("package.json").exists()
}

fn resolve_local_extractor_dir(app: &tauri::AppHandle) -> Result<(PathBuf, bool), String> {
    let mut checked_paths: Vec<PathBuf> = Vec::new();

    if let Ok(resource_dir) = app.path().resource_dir() {
        let resource_candidates = vec![
            resource_dir.join("local-extractor"),
            resource_dir.join("resources").join("local-extractor"),
            resource_dir.join("..").join("resources").join("local-extractor"),
        ];

        for bundled in resource_candidates {
            checked_paths.push(bundled.clone());
            if is_local_extractor_dir(&bundled) {
                return Ok((bundled, true));
            }
        }
    }

    let mut candidates: Vec<PathBuf> = Vec::new();

    if let Ok(current_dir) = std::env::current_dir() {
        candidates.push(current_dir.join("../local-extractor"));
        candidates.push(current_dir.join("../../local-extractor"));
        candidates.push(current_dir.join("../../../local-extractor"));
        candidates.push(current_dir.join("local-extractor"));
    }

    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(exe_dir) = exe_path.parent() {
            candidates.push(exe_dir.join("local-extractor"));
            candidates.push(exe_dir.join("resources").join("local-extractor"));
            candidates.push(exe_dir.join("../local-extractor"));
            candidates.push(exe_dir.join("../resources").join("local-extractor"));
            candidates.push(exe_dir.join("../../local-extractor"));
            candidates.push(exe_dir.join("../../../local-extractor"));
        }
    }

    for candidate in candidates {
        checked_paths.push(candidate.clone());
        if is_local_extractor_dir(&candidate) {
            return Ok((candidate, false));
        }
    }

    let checked = checked_paths
        .iter()
        .map(|p| p.to_string_lossy().to_string())
        .collect::<Vec<_>>()
        .join(" | ");

    Err(format!(
        "local-extractor directory not found. Checked: {}",
        checked
    ))
}

fn resolve_node_command(app: &tauri::AppHandle, prefer_bundled: bool) -> String {
    if prefer_bundled {
        if let Ok(resource_dir) = app.path().resource_dir() {
            let node_exe = if cfg!(target_os = "windows") { "node.exe" } else { "node" };
            // Strip \\?\ first, then search — the prefix can break exists() checks
            let clean_res = PathBuf::from(
                resource_dir.to_string_lossy().replace(r"\\?\", "").replace(r"\?\", "")
            );
            let candidates = [
                clean_res.join("runtime").join(node_exe),
                clean_res.join("resources").join("runtime").join(node_exe),
                clean_res.join("..").join("resources").join("runtime").join(node_exe),
            ];
            for candidate in &candidates {
                if candidate.exists() {
                    return candidate.to_string_lossy().to_string();
                }
            }
        }
    }
    "node".to_string()
}

fn has_extractor_deps(extractor_dir: &Path) -> bool {
    extractor_dir.join("node_modules").join("puppeteer-core").exists()
        || extractor_dir.join("node_modules").join("puppeteer").exists()
}

fn add_browser_candidate(candidates: &mut Vec<PathBuf>, env_var: &str, rel: &str) {
    if let Ok(base) = std::env::var(env_var) {
        candidates.push(PathBuf::from(base).join(rel));
    }
}

#[cfg(target_os = "windows")]
fn query_registry_app_path(exe_name: &str) -> Option<PathBuf> {
    let keys = [
        format!(r"HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\{exe_name}"),
        format!(r"HKLM\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\App Paths\{exe_name}"),
        format!(r"HKCU\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\{exe_name}"),
    ];

    for key in keys {
        let mut cmd = std::process::Command::new("reg");
        cmd.args(["query", &key, "/ve"]);
        cmd.creation_flags(CREATE_NO_WINDOW);

        let output = match cmd.output() {
            Ok(output) => output,
            Err(_) => continue,
        };

        if !output.status.success() {
            continue;
        }

        let stdout = String::from_utf8_lossy(&output.stdout);
        for line in stdout.lines() {
            if !line.contains("REG_SZ") {
                continue;
            }

            let value = line
                .splitn(2, "REG_SZ")
                .nth(1)
                .map(|v| v.trim())
                .unwrap_or_default();

            if value.is_empty() {
                continue;
            }

            let candidate = PathBuf::from(value.trim_matches('"'));
            if candidate.exists() {
                return Some(candidate);
            }
        }
    }

    None
}

fn find_latest_webview2_executable(base: &Path) -> Option<PathBuf> {
    let mut versions: Vec<PathBuf> = std::fs::read_dir(base)
        .ok()?
        .filter_map(|entry| entry.ok().map(|e| e.path()))
        .filter(|path| path.is_dir())
        .collect();

    versions.sort_by(|a, b| {
        a.file_name()
            .unwrap_or_default()
            .cmp(b.file_name().unwrap_or_default())
    });
    versions.reverse();

    versions
        .into_iter()
        .map(|version_dir| version_dir.join("msedgewebview2.exe"))
        .find(|exe| exe.exists())
}

#[cfg(target_os = "windows")]
fn query_path_executable(exe_name: &str) -> Option<PathBuf> {
    let mut cmd = std::process::Command::new("where");
    cmd.arg(exe_name);
    cmd.creation_flags(CREATE_NO_WINDOW);
    let output = cmd.output().ok()?;

    if !output.status.success() {
        return None;
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    stdout
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(|line| PathBuf::from(line.trim_matches('"')))
        .find(|path| path.exists())
}

#[cfg(target_os = "windows")]
fn push_env_paths(candidates: &mut Vec<PathBuf>, rel_paths: &[&str]) {
    for rel in rel_paths {
        add_browser_candidate(candidates, "ProgramFiles", rel);
        add_browser_candidate(candidates, "ProgramFiles(x86)", rel);
        add_browser_candidate(candidates, "LOCALAPPDATA", rel);
    }
}

/// Resolve a browser executable for Puppeteer:
/// 1) explicit env override
/// 2) installed Chromium-based browsers (common paths, registry, PATH)
/// 3) installed WebView2 runtime
fn resolve_browser_executable() -> Option<PathBuf> {
    if let Ok(explicit) = std::env::var("PUPPETEER_EXECUTABLE_PATH") {
        let explicit_path = PathBuf::from(explicit);
        if explicit_path.exists() {
            return Some(explicit_path);
        }
    }

    #[cfg(target_os = "windows")]
    {
        let browser_specs: &[(&[&str], &[&str])] = &[
            // Microsoft Edge
            (&["msedge.exe"], &[r"Microsoft\Edge\Application\msedge.exe"]),
            // Google Chrome
            (&["chrome.exe"], &[r"Google\Chrome\Application\chrome.exe"]),
            // Brave
            (&["brave.exe"], &[r"BraveSoftware\Brave-Browser\Application\brave.exe"]),
            // Chromium
            (&["chromium.exe", "chrome.exe"], &[r"Chromium\Application\chrome.exe"]),
            // Vivaldi
            (&["vivaldi.exe"], &[r"Vivaldi\Application\vivaldi.exe"]),
            // Opera (stable + GX)
            (
                &["opera.exe"],
                &[
                    r"Opera\launcher.exe",
                    r"Programs\Opera\opera.exe",
                    r"Programs\Opera GX\opera.exe",
                ],
            ),
            // Yandex Browser
            (&["browser.exe"], &[r"Yandex\YandexBrowser\Application\browser.exe"]),
            // Arc
            (&["arc.exe"], &[r"Programs\Arc\Arc.exe"]),
        ];

        for (exe_names, rel_paths) in browser_specs {
            let mut candidates = Vec::new();
            push_env_paths(&mut candidates, rel_paths);

            if let Some(found) = candidates.into_iter().find(|path| path.exists()) {
                return Some(found);
            }

            for exe_name in *exe_names {
                if let Some(found) = query_registry_app_path(exe_name) {
                    return Some(found);
                }
            }

            for exe_name in *exe_names {
                if let Some(found) = query_path_executable(exe_name) {
                    return Some(found);
                }
            }
        }
    }

    let mut webview_bases = Vec::new();
    add_browser_candidate(
        &mut webview_bases,
        "ProgramFiles",
        r"Microsoft\EdgeWebView\Application",
    );
    add_browser_candidate(
        &mut webview_bases,
        "ProgramFiles(x86)",
        r"Microsoft\EdgeWebView\Application",
    );
    add_browser_candidate(
        &mut webview_bases,
        "LOCALAPPDATA",
        r"Microsoft\EdgeWebView\Application",
    );

    webview_bases
        .into_iter()
        .find_map(|base| find_latest_webview2_executable(&base))
}

fn ensure_extractor_deps(extractor_dir: &Path) -> Result<(), String> {
    if has_extractor_deps(extractor_dir) {
        return Ok(());
    }
    // Dependencies should be pre-bundled by the build script.
    // Do NOT attempt runtime npm install — it triggers AV heuristics
    // and won't work on fresh PCs without npm installed.
    Err("Extractor dependencies (node_modules) are missing. Please reinstall the application.".to_string())
}

#[tauri::command]
async fn extract_provider_stream(
    app: tauri::AppHandle,
    state: tauri::State<'_, ExtractorSidecarState>,
    args: ExtractProviderArgs,
) -> Result<ExtractProviderResult, String> {
    let (extractor_dir, is_bundled) = resolve_local_extractor_dir(&app)
        .map_err(|e| format!("[Extractor] Directory not found: {e}"))?;

    // Strip \\?\ prefix from extractor dir path for child process compatibility
    let clean_extractor_dir = PathBuf::from(
        extractor_dir.to_string_lossy().replace(r"\\?\", "").replace(r"\?\", "")
    );

    let node_command = resolve_node_command(&app, is_bundled);

    // If bundled mode but node.exe wasn't found, fail with diagnostic info
    if is_bundled && node_command == "node" {
        let res_dir = app.path().resource_dir().map(|p| p.to_string_lossy().to_string()).unwrap_or_default();
        return Err(format!(
            "[Extractor] Bundled node.exe not found. resource_dir={}, extractor_dir={}",
            res_dir, clean_extractor_dir.display()
        ));
    }

    let browser_executable = {
        let mut cache = state.browser_executable.lock().await;
        let cached_valid = cache.as_ref().filter(|path| path.exists()).cloned();
        if let Some(path) = cached_valid {
            Some(path)
        } else {
            let resolved = resolve_browser_executable();
            *cache = resolved.clone();
            resolved
        }
    };
    if browser_executable.is_none() {
        return Err(
            "[Extractor] No supported Chromium browser found. Install Edge, Chrome, Brave, Chromium, Vivaldi, Opera, Arc, Yandex, or WebView2 Runtime."
                .to_string(),
        );
    }
    let dep_dir = clean_extractor_dir.clone();
    tauri::async_runtime::spawn_blocking(move || ensure_extractor_deps(dep_dir.as_path()))
        .await
        .map_err(|e| format!("[Extractor] Dependency check failed: {e}"))??;

    let media_type = args.media_type.to_lowercase();
    if media_type != "movie" && media_type != "tv" {
        return Err("mediaType must be 'movie' or 'tv'".to_string());
    }

    let mut req_args = args;
    req_args.media_type = media_type;
    if req_args.base_url.is_none() {
        req_args.base_url = Some("https://vidlink.pro".to_string());
    }

    let mut guard = state.sidecar.lock().await;

    let should_restart = match guard.as_mut() {
        None => true,
        Some(sidecar) => {
            let path_changed = sidecar.extractor_dir != clean_extractor_dir;
            let node_changed = sidecar.node_command != node_command;
            let browser_changed = sidecar.browser_executable != browser_executable;
            let dead = match sidecar.child.try_wait() {
                Ok(Some(_)) => true,
                Ok(None) => false,
                Err(_) => true,
            };
            path_changed || node_changed || browser_changed || dead
        }
    };

    if should_restart {
        if let Some(mut old) = guard.take() {
            let _ = old.child.start_kill();
        }

        let spawned = ExtractorSidecar::spawn(
            clean_extractor_dir.clone(),
            node_command.clone(),
            browser_executable,
        )
        .await
        .map_err(|e| format!("[Extractor] Failed to start: {e}"))?;

        *guard = Some(spawned);
    }

    let sidecar = guard
        .as_mut()
        .ok_or_else(|| "Extractor sidecar unavailable".to_string())?;

    sidecar.extract_provider(&req_args).await
}

#[tauri::command]
async fn prepare_extractor_engine(app: tauri::AppHandle) -> Result<String, String> {
    let (extractor_dir, _is_bundled) = resolve_local_extractor_dir(&app)?;

    let clean_dir = PathBuf::from(
        extractor_dir.to_string_lossy().replace(r"\\?\", "").replace(r"\?\", "")
    );

    let dep_dir = clean_dir.clone();
    tauri::async_runtime::spawn_blocking(move || ensure_extractor_deps(dep_dir.as_path()))
        .await
        .map_err(|e| format!("Failed to check extractor deps: {e}"))??;

    Ok("ready".to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let proxy_state = proxy::ProxyState::new();
    let proxy_state_clone = proxy_state.clone();

    tauri::Builder::default()
        .plugin(tauri_plugin_sql::Builder::default().build())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(proxy_state)
        .manage(ExtractorSidecarState::default())

        .invoke_handler(tauri::generate_handler![
            get_proxy_port,
            set_proxy_headers,
            clear_proxy_cache,
            extract_provider_stream,
            prepare_extractor_engine,
        ])
        .setup(move |app| {
            let window = app.get_webview_window("main").unwrap();

            #[cfg(target_os = "windows")]
            {
                let _ = window.set_shadow(true);
            }

            // --- Production hardening ---
            // Open devtools only in debug builds (feature-gated: won't even compile in release)
            #[cfg(debug_assertions)]
            {
                window.open_devtools();
            }

            tauri::async_runtime::spawn(async move {
                proxy::start_proxy(proxy_state_clone).await;
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}


