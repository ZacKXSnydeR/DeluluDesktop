#!/usr/bin/env node
"use strict";

const { LocalExtractor } = require("./src");

function parseArgs(argv) {
  const result = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) {
      result._.push(token);
      continue;
    }

    const key = token.slice(2);
    const next = argv[i + 1];

    if (!next || next.startsWith("--")) {
      result[key] = true;
      continue;
    }

    result[key] = next;
    i += 1;
  }
  return result;
}

function toInt(value, fieldName) {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isInteger(parsed)) {
    throw new Error(`Invalid ${fieldName}`);
  }
  return parsed;
}

function printHelp() {
  console.log(`Usage:
  local-extractor extract --url <url> [--bypass-cache]
  local-extractor extract-provider --media-type <movie|tv> --tmdb-id <id> --base-url <url> [--season <n> --episode <n>]
  local-extractor stats`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const command = args._[0];

  if (!command || command === "--help" || command === "help") {
    printHelp();
    process.exit(0);
  }

  const extractor = new LocalExtractor({
    logger: (level, event, data) => {
      if (process.env.DEBUG_EXTRACTOR === "1") {
        console.error(JSON.stringify({ level, event, data }));
      }
    }
  });

  try {
    if (command === "stats") {
      console.log(JSON.stringify({ success: true, data: extractor.getStats() }, null, 2));
      return;
    }

    if (command === "extract") {
      if (!args.url) throw new Error("Missing --url");
      const result = await extractor.extractUrl(String(args.url), {
        bypassCache: Boolean(args["bypass-cache"])
      });
      console.log(JSON.stringify(result, null, 2));
      process.exit(result.success ? 0 : 2);
      return;
    }

    if (command === "extract-provider" || command === "extract-vidlink") {
      const mediaType = String(args["media-type"] || "");
      const tmdbId = toInt(args["tmdb-id"], "tmdb-id");

      const payload = {
        mediaType,
        tmdbId,
        baseUrl: args["base-url"]
      };

      if (mediaType === "tv") {
        payload.season = toInt(args.season, "season");
        payload.episode = toInt(args.episode, "episode");
      }

      const result = await extractor.extractProvider(payload, {
        bypassCache: Boolean(args["bypass-cache"])
      });

      console.log(JSON.stringify(result, null, 2));
      process.exit(result.success ? 0 : 2);
      return;
    }

    throw new Error(`Unknown command: ${command}`);
  } catch (error) {
    console.error(JSON.stringify({ success: false, error: error.message }, null, 2));
    process.exit(1);
  }
}

main();
