// Persistent idempotency store — JSON file, atomic write (tmp -> rename).
//
// The in-memory idempotency map in src/turn.ts is lost on server
// restart/redeploy, so a platform retry after a restart could be answered
// twice. This store mirrors the map to disk when IDEMPOTENCY_STORE_PATH
// is set (e.g. /data/idempotency.json on a host with a volume). When the
// variable is NOT set, the agent behaves exactly as before (memory only).
//
// Write pattern (Whale Sentinel's state.mjs): write the full JSON to a
// temp file in the same directory, then rename over the target — a crash
// mid-write can never leave a half-written store file. A corrupt store
// file is ignored with a warning (start empty) instead of crashing the
// server. Save failures are logged, never thrown — the in-memory map
// stays authoritative for the running process.
//
// The store file must be gitignored (see .gitignore: data/) — it holds
// live match state, not source.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

export interface JsonStore<T> {
  path: string;
  load(): T | null;
  save(data: T): void;
}

export function createJsonStore<T>(filePath: string): JsonStore<T> {
  return {
    path: filePath,
    load(): T | null {
      try {
        if (!existsSync(filePath)) return null;
        const raw = readFileSync(filePath, "utf8");
        return JSON.parse(raw) as T;
      } catch (e) {
        console.warn(`[store] ignoring unreadable store file ${filePath}: ${(e as Error).message}`);
        return null;
      }
    },
    save(data: T): void {
      try {
        mkdirSync(path.dirname(filePath), { recursive: true });
        const tmp = `${filePath}.tmp-${process.pid}`;
        writeFileSync(tmp, JSON.stringify(data), { mode: 0o600 });
        renameSync(tmp, filePath);
      } catch (e) {
        // Never crash the turn handler over persistence — log and continue
        // with the in-memory map.
        console.warn(`[store] failed to persist ${filePath}: ${(e as Error).message}`);
      }
    },
  };
}
