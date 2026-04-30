// Namespaced debug channels. Enable from devtools:
//   localStorage.setItem('lynk:debug', 'ocr,table,extractor'); location.reload()
//   localStorage.setItem('lynk:debug', '*'); location.reload()
//
// Channels in use:
//   ocr        - core/extraction/ocrExtractor
//   table      - core/extraction/tableParser
//   extractor  - components/nodes/ExtractorNode
//   reconcile  - core/reconciliation
//   canvas     - core/engine/connectionValidation
//
// Live read:        mcp__claude-in-chrome__read_console_messages pattern "\\[lynk:"
// Retroactive read: javascript_tool -> window.__lynkDebug / getDebugLog()

type Entry = { ts: number; channel: string; args: unknown[] };

const RING_CAP = 500;
const ring: Entry[] = [];

const raw = typeof localStorage !== 'undefined' ? localStorage.getItem('lynk:debug') : null;
const all = raw === '*';
const enabled = new Set(
  raw && !all ? raw.split(',').map((s) => s.trim()).filter(Boolean) : [],
);

function push(entry: Entry) {
  ring.push(entry);
  if (ring.length > RING_CAP) ring.shift();
}

export function debug(channel: string) {
  const on = all || enabled.has(channel);
  if (!on) return () => {};
  const tag = `[lynk:${channel}]`;
  return (...args: unknown[]) => {
    push({ ts: Date.now(), channel, args });
    console.log(tag, ...args);
  };
}

export function getDebugLog(channel?: string): Entry[] {
  return channel ? ring.filter((e) => e.channel === channel) : ring.slice();
}

export function clearDebugLog() {
  ring.length = 0;
}

if (typeof window !== 'undefined') {
  (window as unknown as { __lynkDebug: { log: Entry[]; get: typeof getDebugLog; clear: typeof clearDebugLog } }).__lynkDebug = {
    log: ring,
    get: getDebugLog,
    clear: clearDebugLog,
  };
}
