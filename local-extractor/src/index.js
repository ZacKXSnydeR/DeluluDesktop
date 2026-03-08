"use strict";

const { LocalExtractor } = require("./extractor");
const {
  resolveProviderBaseUrl,
  buildProviderMovieUrl,
  buildProviderTvUrl,
  buildProviderUrl,
  buildVidlinkMovieUrl,
  buildVidlinkTvUrl,
  buildVidlinkUrl
} = require("./vidlink");
const { DEFAULT_CONFIG, USER_AGENTS, VIEWPORTS } = require("./config");

module.exports = {
  LocalExtractor,
  resolveProviderBaseUrl,
  buildProviderMovieUrl,
  buildProviderTvUrl,
  buildProviderUrl,
  buildVidlinkMovieUrl,
  buildVidlinkTvUrl,
  buildVidlinkUrl,
  DEFAULT_CONFIG,
  USER_AGENTS,
  VIEWPORTS
};
