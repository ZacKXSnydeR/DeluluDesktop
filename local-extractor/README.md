# local-extractor

Local-first HLS extraction engine for desktop apps.

`local-extractor` runs on the user's machine and returns:
- candidate stream URLs (`.m3u8`, `.mpd`, `.mp4`)
- required playback headers (`Referer`, `Origin`, `User-Agent`)
- subtitle tracks (`.vtt`, `.srt`, `.ass`, `.ssa`)

No hosted extraction backend is required.

## Who This Is For

- Tauri desktop apps (Rust core or JS-driven)
- local media tools that need stream URL discovery
- teams that want zero server cost for extraction

## Quick Start

```bash
npm install
npm run check
```

Set provider base URL (PowerShell):

```bash
$env:LOCAL_EXTRACTOR_PROVIDER_BASE_URL = "https://your-provider-domain.example"
```

Run a quick extraction:

```bash
node cli.js extract-provider --media-type movie --tmdb-id 157336
```

## Why Use It

- `local execution`: requests come from end-user network
- `cost control`: no always-on extraction server
- `desktop-safe flow`: queue + timeout + cleanup behavior
- `integration options`: CLI, JS API, STDIO sidecar protocol

## Features

- headless-browser extraction with Puppeteer
- network interception + JS/JSON body scan
- stream prioritization and subtitle capture
- FIFO queue for stable concurrency
- in-memory cache with TTL
- backward-compatible legacy action aliases

## CLI Commands

Show help:

```bash
node cli.js --help
```

Extract from direct URL:

```bash
node cli.js extract --url "https://your-provider-domain.example/movie/12345"
```

Extract from `mediaType + tmdbId`:

```bash
node cli.js extract-provider --media-type movie --tmdb-id 157336 --base-url "https://your-provider-domain.example"
node cli.js extract-provider --media-type tv --tmdb-id 1396 --season 1 --episode 1 --base-url "https://your-provider-domain.example"
```

Bypass cache:

```bash
node cli.js extract-provider --media-type movie --tmdb-id 157336 --bypass-cache
```

Queue/cache stats:

```bash
node cli.js stats
```

## JS API

```js
const { LocalExtractor } = require("./src");

async function run() {
  const extractor = new LocalExtractor();
  const result = await extractor.extractProvider({
    mediaType: "movie",
    tmdbId: 157336,
    baseUrl: "https://your-provider-domain.example"
  });

  if (!result.success) {
    console.error(result.error);
    return;
  }

  console.log("Stream:", result.stream_url);
  console.log("Headers:", result.headers);
  console.log("Subtitles:", result.subtitles);
}

run();
```

## Tauri Integration

Recommended approach:
- run `stdio-bridge.js` as a sidecar
- communicate over newline-delimited JSON
- keep extractor process local to app runtime

### Rust Core Example (Sidecar + STDIO)

```rust
use serde_json::json;
use tauri::Manager;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::Command;

#[tauri::command]
async fn extract_stream() -> Result<serde_json::Value, String> {
    let mut child = Command::new("node")
        .arg("stdio-bridge.js")
        .current_dir("../local-extractor")
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| e.to_string())?;

    let mut stdin = child.stdin.take().ok_or("missing stdin")?;
    let stdout = child.stdout.take().ok_or("missing stdout")?;
    let mut reader = BufReader::new(stdout).lines();

    let _ready = reader.next_line().await.map_err(|e| e.to_string())?;

    let req = json!({
      "id": "req-1",
      "action": "extract_provider",
      "payload": {
        "mediaType": "movie",
        "tmdbId": 157336,
        "baseUrl": "https://your-provider-domain.example"
      }
    });

    stdin
      .write_all(format!("{}\n", req).as_bytes())
      .await
      .map_err(|e| e.to_string())?;

    let line = reader
      .next_line()
      .await
      .map_err(|e| e.to_string())?
      .ok_or("no response")?;

    serde_json::from_str(&line).map_err(|e| e.to_string())
}
```

### JS Frontend Example (Call Tauri Command)

```js
import { invoke } from "@tauri-apps/api/core";

const result = await invoke("extract_stream");
if (result.success) {
  // use result.stream_url, result.headers, result.subtitles
}
```

### STDIO Protocol

Request:

```json
{"id":"req-1","action":"extract_provider","payload":{"mediaType":"movie","tmdbId":157336,"baseUrl":"https://your-provider-domain.example"}}
```

Response:

```json
{"id":"req-1","success":true,"stream_url":"https://...m3u8","headers":{"Referer":"...","Origin":"...","User-Agent":"..."},"subtitles":[]}
```

Supported actions:
- `health`
- `stats`
- `extract_url`
- `extract_provider`

Legacy alias:
- `extract_vidlink`

## Extraction Pipeline

1. Validate and normalize input.
2. Enqueue request (FIFO).
3. Launch browser session with hardened defaults.
4. Capture stream/subtitle candidates from requests.
5. Parse eligible JS/JSON responses for embedded URLs.
6. Trigger play interactions with fallback clicks.
7. Score and select best stream candidate.
8. Return stream + headers + subtitles + metadata.
9. Cleanup pages/browser aggressively.

## Response Format

```json
{
  "success": true,
  "stream_url": "https://...m3u8",
  "headers": {
    "Referer": "https://...",
    "Origin": "https://...",
    "User-Agent": "..."
  },
  "subtitles": [
    { "url": "https://...vtt", "language": "English" }
  ],
  "all_streams": [
    { "url": "https://...m3u8", "priority": 10 }
  ],
  "meta": {
    "cacheHit": false,
    "durationMs": 8200,
    "queueWaitMs": 0,
    "targetUrl": "https://your-provider-domain.example/movie/12345"
  }
}
```

## AI Assistant Friendly Section

If you are using an AI coding assistant, provide:
- command to run (`node cli.js extract-provider ...`)
- whether cache must be bypassed (`--bypass-cache`)
- provider base URL (`--base-url` or env var)
- expected output fields (`stream_url`, `headers`, `subtitles`)

Recommended deterministic test prompt:

```text
Run local-extractor with extract-provider for a movie tmdb id, bypass cache,
and return only: success, stream_url, headers, subtitles count.
```

## Troubleshooting

- `Missing provider base URL`: set `LOCAL_EXTRACTOR_PROVIDER_BASE_URL` or pass `--base-url`.
- `No streams found`: increase timeout, verify provider URL pattern, test direct `extract --url`.
- `Timeout`: run with fewer concurrent tasks and ensure browser dependencies are available.
- `Subtitles empty`: source may not expose subtitle tracks for selected title/server.

## Safety and Legal

- Use only with content/services you are authorized to access.
- Respect provider terms, local law, and copyright requirements.
- Do not use this project to bypass DRM or restricted content controls.

## Development

```bash
npm run check
```

## License

MIT. See `LICENSE`.
