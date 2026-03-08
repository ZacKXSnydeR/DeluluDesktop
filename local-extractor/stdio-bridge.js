#!/usr/bin/env node
"use strict";

const readline = require("readline");
const { LocalExtractor } = require("./src");

const extractor = new LocalExtractor({
  logger: (level, event, data) => {
    if (process.env.DEBUG_EXTRACTOR === "1") {
      writeMessage({ type: "log", level, event, data });
    }
  }
});

const rl = readline.createInterface({
  input: process.stdin,
  crlfDelay: Infinity
});

function writeMessage(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function writeError(id, error) {
  writeMessage({
    id: id || null,
    success: false,
    error: error instanceof Error ? error.message : String(error)
  });
}

async function handleMessage(rawLine) {
  if (!rawLine.trim()) return;

  let msg;
  try {
    msg = JSON.parse(rawLine);
  } catch {
    writeError(null, "Invalid JSON input");
    return;
  }

  const { id, action, payload = {} } = msg;

  try {
    if (action === "health") {
      writeMessage({
        id: id || null,
        success: true,
        data: {
          status: "ok",
          timestamp: new Date().toISOString(),
          stats: extractor.getStats()
        }
      });
      return;
    }

    if (action === "stats") {
      writeMessage({ id: id || null, success: true, data: extractor.getStats() });
      return;
    }

    if (action === "extract_url") {
      const result = await extractor.extractUrl(payload.url, {
        bypassCache: Boolean(payload.bypassCache),
        timeoutMs: payload.timeoutMs
      });
      writeMessage({ id: id || null, ...result });
      return;
    }

    if (action === "extract_provider" || action === "extract_vidlink") {
      const result = await extractor.extractProvider(payload, {
        bypassCache: Boolean(payload.bypassCache),
        timeoutMs: payload.timeoutMs
      });
      writeMessage({ id: id || null, ...result });
      return;
    }

    writeError(id, `Unsupported action: ${action}`);
  } catch (error) {
    writeError(id, error);
  }
}

rl.on("line", (line) => {
  handleMessage(line).catch((error) => writeError(null, error));
});

rl.on("close", () => {
  process.exit(0);
});

writeMessage({
  type: "ready",
  success: true,
  version: "1.0.0"
});
