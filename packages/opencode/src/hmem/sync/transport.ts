/**
 * hmem-sync HTTP transport layer.
 *
 * All communication with the hmem-sync server:
 *   POST /register          — create an account, get a bearer token
 *   GET  /salt/:userId      — retrieve the public salt for a user
 *   POST /blobs             — push encrypted blobs (batched)
 *   GET  /blobs?since=...   — pull blobs updated since a timestamp
 */

import type { EncryptedBlob, SyncBlob } from "./crypto"

// ---- Types ----

export interface PushResult {
  stored: number
}

export interface PullResponse {
  blobs: Array<{ id_hash: string; blob: EncryptedBlob; updated_at: string }>
  server_time?: string
}

export interface RegisterResult {
  token: string
}

// ---- Helpers ----

function authHeaders(token: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  }
}

async function parseJsonOrThrow<T>(res: Response, context: string): Promise<T> {
  const text = await res.text()
  if (!res.ok) {
    let errMsg = "unknown"
    try {
      errMsg = (JSON.parse(text) as { error?: string }).error ?? "unknown"
    } catch { /* ignore */ }
    throw new Error(`${context} failed (${res.status}): ${errMsg}`)
  }
  try {
    return JSON.parse(text) as T
  } catch {
    throw new Error(`${context}: invalid JSON response (${res.status}): ${text.substring(0, 200)}`)
  }
}

// ---- Push ----

/**
 * Push encrypted blobs to the server in batches.
 * Returns the total number of blobs stored server-side.
 */
export async function pushBlobs(
  serverUrl: string,
  token: string,
  blobs: SyncBlob[],
  batchSize = 200,
): Promise<number> {
  let totalStored = 0
  for (let i = 0; i < blobs.length; i += batchSize) {
    const chunk = blobs.slice(i, i + batchSize)
    const res = await fetch(`${serverUrl}/blobs`, {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify(chunk),
    })
    const data = await parseJsonOrThrow<PushResult>(res, "Push")
    totalStored += data.stored
  }
  return totalStored
}

// ---- Pull ----

/**
 * Pull blobs from the server updated after `since` (ISO timestamp).
 * Pass null to fetch all blobs.
 */
export async function pullBlobs(
  serverUrl: string,
  token: string,
  since: string | null,
): Promise<PullResponse> {
  const url = since
    ? `${serverUrl}/blobs?since=${encodeURIComponent(since)}`
    : `${serverUrl}/blobs`

  const res = await fetch(url, {
    headers: authHeaders(token),
  })

  const text = await res.text()
  if (!res.ok) {
    let errMsg = "unknown"
    try { errMsg = (JSON.parse(text) as { error?: string }).error ?? "unknown" } catch { /* ignore */ }
    throw new Error(`Pull failed (${res.status}): ${errMsg}`)
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error(`Pull: invalid JSON response (${res.status}): ${text.substring(0, 200)}`)
  }

  // Support both new { blobs, server_time } format and legacy flat array
  if (Array.isArray(parsed)) {
    return { blobs: parsed as PullResponse["blobs"] }
  }
  return parsed as PullResponse
}

// ---- Register ----

/**
 * Register a new sync account.
 * Returns the bearer token to store locally.
 */
export async function register(
  serverUrl: string,
  userId: string,
  salt: string,
): Promise<string> {
  const res = await fetch(`${serverUrl}/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId, salt }),
  })
  const data = await parseJsonOrThrow<RegisterResult>(res, "Register")
  return data.token
}

// ---- Fetch salt ----

/**
 * Retrieve the public salt for an existing user.
 * Used during "restore" flow on a new device.
 */
export async function fetchSalt(serverUrl: string, userId: string): Promise<string> {
  const res = await fetch(`${serverUrl}/salt/${encodeURIComponent(userId)}`)
  const data = await parseJsonOrThrow<{ salt: string }>(res, "FetchSalt")
  return data.salt
}
