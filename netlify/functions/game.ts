import { getStore } from "@netlify/blobs";
import { createRuntime } from "../game-engine.ts";

const MAX_CAS_ATTEMPTS = 18;
const ROOM_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}
function failure(status: number, code: string, message: string): Response {
  return json({ error: { code, message } }, status);
}
function roomKey(code: string): string { return `room:${code.toUpperCase()}`; }
function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)); }

async function readRoom(store: ReturnType<typeof getStore>, code: string) {
  return store.getWithMetadata(roomKey(code), { consistency: "strong", type: "json" });
}

async function handleCreate(store: ReturnType<typeof getStore>, body: any): Promise<Response> {
  for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt++) {
    const result = await createRuntime(undefined, "create", body);
    if (result.status >= 400 || !result.room || !result.body?.code) {
      return json(result.body, result.status);
    }
    const room = result.room;
    room.lastActivityAt = Date.now();
    const saved = await store.setJSON(roomKey(room.code), room, { onlyIfNew: true });
    if (saved.modified) return json(result.body, result.status);
  }
  return failure(503, "ROOM_CODE_BUSY", "Could not reserve a room code. Please try again.");
}

async function mutateExisting(store: ReturnType<typeof getStore>, code: string, action: string, body: any): Promise<Response> {
  const key = roomKey(code);
  for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt++) {
    const current = await readRoom(store, code);
    if (!current || !current.data) return failure(404, "ROOM_NOT_FOUND", "That room expired or does not exist. Create a new room or join a fresh code.");
    const room: any = current.data;
    if (room.expired) return failure(404, "ROOM_NOT_FOUND", "That room has expired. Create a new room or join a fresh code.");
    if (Date.now() - (room.lastActivityAt || 0) > ROOM_TTL_MS) {
      const tombstone = { expired: true, lastActivityAt: Date.now() };
      const expired = await store.setJSON(key, tombstone, { onlyIfMatch: current.etag });
      if (expired.modified) return failure(404, "ROOM_NOT_FOUND", "That room has expired. Create a new room or join a fresh code.");
      continue;
    }
    const result = await createRuntime(clone(room), action, body);
    if (result.status >= 400 && !result.changed) return json(result.body, result.status);
    if (!result.room) return json(result.body, result.status);
    const saved = await store.setJSON(key, result.room, { onlyIfMatch: current.etag });
    if (saved.modified) return json(result.body, result.status);
    await sleep(5 + Math.floor(Math.random() * 20));
  }
  return failure(409, "ROOM_BUSY", "Another action updated this room at the same time. Please retry.");
}

export default async function game(request: Request): Promise<Response> {
  if (request.method !== "POST") return failure(405, "METHOD_NOT_ALLOWED", "Use POST for game actions.");
  const length = Number(request.headers.get("content-length") || 0);
  if (length > 16_000) return failure(413, "TOO_LARGE", "Request is too large.");
  let body: any;
  try {
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > 16_000) return failure(413, "TOO_LARGE", "Request is too large.");
    body = raw ? JSON.parse(raw) : {};
  } catch {
    return failure(400, "BAD_JSON", "Request was not valid JSON. Please try again.");
  }
  if (!body || typeof body !== "object" || Array.isArray(body) || typeof body.action !== "string") {
    return failure(400, "BAD_ACTION", "Choose a valid game action.");
  }
  const action = body.action;
  // Resolve the Blobs store inside each invocation so the function does not retain
  // a module-scoped store instance across warm invocations. Netlify supplies the
  // site credentials automatically in Functions.
  const store = getStore({ name: "last-alibi-rooms", consistency: "strong" });
  if (action === "create") return handleCreate(store, body);
  if (!/^(join|reconnect|state|start|investigate|notebook|question|question-response|challenge|challenge-response|statement|chat|call-vote|vote|rematch)$/.test(action)) {
    return failure(404, "NOT_FOUND", "That action is not available.");
  }
  const code = typeof body.code === "string" ? body.code.trim().toUpperCase() : "";
  if (!/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{5}$/.test(code)) return failure(400, "INVALID_CODE", "Enter a valid five-character room code.");
  return mutateExisting(store, code, action, body);
}
