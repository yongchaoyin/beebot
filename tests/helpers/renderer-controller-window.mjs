import vm from "node:vm";
import { webcrypto } from "node:crypto";

/**
 * Minimal window for non-DOM controller tests. This is not a DOM emulator;
 * rendered UI is verified separately in a browser. All timers are disposed.
 */
export class Window extends EventTarget {
  constructor({ url = "https://beebot.local" } = {}) {
    super();
    this.location = new URL(url);
    this.Event = Event;
    this.CustomEvent = CustomEvent;
    this.document = { getElementById: () => null };
    const timeouts = new Set(), intervals = new Set();
    this.close = () => {
      for (const timer of timeouts) clearTimeout(timer);
      for (const timer of intervals) clearInterval(timer);
      timeouts.clear(); intervals.clear();
    };
    const sandbox = vm.createContext({
      window: this, document: this.document, console, crypto: webcrypto,
      Event, CustomEvent, EventTarget, AbortController, URL, structuredClone,
      queueMicrotask,
      setTimeout(fn, ms) {
        const timer = setTimeout(() => { timeouts.delete(timer); fn(); }, ms);
        timeouts.add(timer); return timer;
      },
      clearTimeout(timer) { clearTimeout(timer); timeouts.delete(timer); },
      setInterval(fn, ms) { const timer = setInterval(fn, ms); intervals.add(timer); return timer; },
      clearInterval(timer) { clearInterval(timer); intervals.delete(timer); },
    });
    this.eval = source => vm.runInContext(source, sandbox, { filename: "renderer-controller.js" });
  }
}
