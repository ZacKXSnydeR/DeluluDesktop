"use strict";

class ResultCache {
  constructor(ttlMs) {
    this.ttlMs = ttlMs;
    this.map = new Map();
    this.timer = setInterval(() => this.cleanup(), 60_000);
    this.timer.unref?.();
  }

  get(key) {
    const entry = this.map.get(key);
    if (!entry) return null;
    if (Date.now() - entry.timestamp > this.ttlMs) {
      this.map.delete(key);
      return null;
    }
    return entry.value;
  }

  set(key, value) {
    this.map.set(key, { value, timestamp: Date.now() });
  }

  cleanup() {
    const now = Date.now();
    for (const [key, entry] of this.map.entries()) {
      if (now - entry.timestamp > this.ttlMs) {
        this.map.delete(key);
      }
    }
  }

  size() {
    return this.map.size;
  }

  clear() {
    this.map.clear();
  }
}

module.exports = {
  ResultCache
};
