"use strict";

class AsyncQueue {
  constructor(maxConcurrent = 1) {
    this.maxConcurrent = maxConcurrent;
    this.running = 0;
    this.pending = [];
  }

  run(taskFn) {
    return new Promise((resolve, reject) => {
      this.pending.push({ taskFn, resolve, reject, enqueuedAt: Date.now() });
      this.#drain();
    });
  }

  #drain() {
    while (this.running < this.maxConcurrent && this.pending.length > 0) {
      const item = this.pending.shift();
      const startedAt = Date.now();
      this.running += 1;

      Promise.resolve()
        .then(() => item.taskFn())
        .then((result) => {
          item.resolve({
            ...result,
            meta: {
              ...(result?.meta || {}),
              queueWaitMs: startedAt - item.enqueuedAt
            }
          });
        })
        .catch(item.reject)
        .finally(() => {
          this.running -= 1;
          this.#drain();
        });
    }
  }

  stats() {
    return {
      running: this.running,
      queued: this.pending.length,
      capacity: this.maxConcurrent
    };
  }
}

module.exports = {
  AsyncQueue
};
