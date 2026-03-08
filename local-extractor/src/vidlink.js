"use strict";

function resolveProviderBaseUrl(inputBaseUrl) {
  const value = inputBaseUrl || process.env.LOCAL_EXTRACTOR_PROVIDER_BASE_URL;
  if (!value) {
    throw new Error("Missing provider base URL. Set LOCAL_EXTRACTOR_PROVIDER_BASE_URL or pass payload.baseUrl");
  }

  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("Invalid provider base URL");
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("Provider base URL must use http/https");
  }

  return parsed.toString().replace(/\/+$/, "");
}

function buildProviderMovieUrl(tmdbId, baseUrl) {
  if (!Number.isInteger(tmdbId) || tmdbId <= 0) {
    throw new Error("Invalid tmdbId for movie");
  }
  const resolvedBaseUrl = resolveProviderBaseUrl(baseUrl);
  return `${resolvedBaseUrl}/movie/${tmdbId}`;
}

function buildProviderTvUrl(tmdbId, season, episode, baseUrl) {
  if (!Number.isInteger(tmdbId) || tmdbId <= 0) {
    throw new Error("Invalid tmdbId for tv");
  }
  if (!Number.isInteger(season) || season <= 0) {
    throw new Error("Invalid season");
  }
  if (!Number.isInteger(episode) || episode <= 0) {
    throw new Error("Invalid episode");
  }
  const resolvedBaseUrl = resolveProviderBaseUrl(baseUrl);
  return `${resolvedBaseUrl}/tv/${tmdbId}/${season}/${episode}`;
}

function buildProviderUrl(input) {
  const mediaType = input.mediaType;
  const baseUrl = input.baseUrl;
  if (mediaType === "movie") {
    return buildProviderMovieUrl(input.tmdbId, baseUrl);
  }
  if (mediaType === "tv") {
    return buildProviderTvUrl(input.tmdbId, input.season, input.episode, baseUrl);
  }
  throw new Error("mediaType must be 'movie' or 'tv'");
}

// Backward-compatible aliases.
const buildVidlinkMovieUrl = buildProviderMovieUrl;
const buildVidlinkTvUrl = buildProviderTvUrl;
const buildVidlinkUrl = buildProviderUrl;

module.exports = {
  resolveProviderBaseUrl,
  buildProviderMovieUrl,
  buildProviderTvUrl,
  buildProviderUrl,
  buildVidlinkMovieUrl,
  buildVidlinkTvUrl,
  buildVidlinkUrl
};
