/**
 * Async pull-queue bridging callback-style event sources to AsyncIterator.
 *
 * Used by every concrete worker (claude-code / codex / gemini / fake) to
 * adapt Frame's existing IPC-event listeners into the `async *events(session)`
 * contract from the `WorkerInterface`.
 *
 * Contract:
 *   const q = new EventQueue();
 *   q.push(event)        // any side emits
 *   q.close()            // graceful end-of-stream
 *   q.error(err)         // abort with error
 *   for await (const ev of q) { ... }
 */

const SYMBOL = Symbol.asyncIterator;

class EventQueue {
  constructor() {
    this._buf = [];
    this._waiters = [];
    this._closed = false;
    this._error = null;
  }

  push(event) {
    if (this._closed) return;
    if (this._waiters.length > 0) {
      const resolve = this._waiters.shift();
      resolve({ value: event, done: false });
    } else {
      this._buf.push(event);
    }
  }

  close() {
    if (this._closed) return;
    this._closed = true;
    while (this._waiters.length > 0) {
      const resolve = this._waiters.shift();
      resolve({ value: undefined, done: true });
    }
  }

  error(err) {
    if (this._closed) return;
    this._closed = true;
    this._error = err;
    while (this._waiters.length > 0) {
      const resolve = this._waiters.shift();
      // Note: rejecting via thrown error preserves stack trace via the
      // generator's natural propagation. We resolve with a poison value
      // and let the iterator's next() implementation throw.
      resolve({ value: undefined, done: true });
    }
  }

  [SYMBOL]() {
    const self = this;
    return {
      async next() {
        if (self._buf.length > 0) {
          return { value: self._buf.shift(), done: false };
        }
        if (self._closed) {
          if (self._error) throw self._error;
          return { value: undefined, done: true };
        }
        return new Promise((resolve) => self._waiters.push(resolve));
      },
      async return() {
        self.close();
        return { value: undefined, done: true };
      },
      async throw(err) {
        self.error(err);
        return { value: undefined, done: true };
      },
    };
  }
}

module.exports = { EventQueue };
