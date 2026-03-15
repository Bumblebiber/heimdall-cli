/**
 * hmem-sync setup and restore flows.
 *
 * setupSync   — first-time registration: generates key material, registers
 *               with the server, and saves config + token.
 *
 * restoreSync — reconnect an existing account on a new device: fetches the
 *               public salt, verifies the token, and saves config + token.
 */

import { generateKeyMaterial } from "./crypto"
import { register, fetchSalt } from "./transport"
import { saveConfig, saveToken } from "./config"
import type { SyncConfig, DatabaseSyncConfig } from "./config"

// ---- Setup ----

export interface SetupInput {
  serverUrl: string
  userId: string
  /** Passphrase is used client-side only — never sent to server */
  passphrase: string
  syncSecrets?: boolean
  databases?: DatabaseSyncConfig[]
}

export interface SetupResult {
  /** Recovery key to show the user exactly once */
  recoveryKey: string
  /** Bearer token — save to .hmem-sync-token, never commit */
  token: string
}

/**
 * First-time setup:
 * 1. Generate random salt + recovery key
 * 2. Register with the server (POST /register) → receive bearer token
 * 3. Persist config and token under Global.Path.sync
 *
 * Returns the recovery key and token to display to the user.
 * Both are shown ONCE — the caller must present them to the user.
 */
export async function setupSync(input: SetupInput): Promise<SetupResult> {
  const { salt, recoveryKey } = generateKeyMaterial()

  const token = await register(input.serverUrl, input.userId, salt)

  const cfg: SyncConfig = {
    serverUrl: input.serverUrl,
    userId: input.userId,
    salt,
    syncSecrets: input.syncSecrets ?? false,
    databases: input.databases ?? [],
  }

  saveConfig(cfg)
  saveToken(token)

  return { recoveryKey, token }
}

// ---- Restore ----

export interface RestoreInput {
  serverUrl: string
  userId: string
  /** Token from the original device (or from hmem-sync setup output) */
  token: string
  syncSecrets?: boolean
  databases?: DatabaseSyncConfig[]
}

/**
 * Restore flow for a new device:
 * 1. Fetch the public salt for the user (GET /salt/:userId)
 * 2. Verify the token works (GET /blobs)
 * 3. Persist config and token under Global.Path.sync
 *
 * Throws if the token is invalid or the server is unreachable.
 */
export async function restoreSync(input: RestoreInput): Promise<void> {
  // Fetch public salt from server
  const salt = await fetchSalt(input.serverUrl, input.userId)

  // Verify the token is valid by hitting /blobs
  const verifyRes = await fetch(`${input.serverUrl}/blobs`, {
    headers: {
      Authorization: `Bearer ${input.token}`,
    },
  })
  if (!verifyRes.ok) {
    throw new Error(
      `Token verification failed (${verifyRes.status}) — check token and server URL`,
    )
  }

  // Normalise token (strip non-printable chars that can appear from copy-paste)
  const token = input.token.replace(/[^\x21-\x7E]/g, "")
  if (!token) throw new Error("Token is empty after sanitisation")

  const cfg: SyncConfig = {
    serverUrl: input.serverUrl,
    userId: input.userId,
    salt,
    syncSecrets: input.syncSecrets ?? false,
    databases: input.databases ?? [],
  }

  saveConfig(cfg)
  saveToken(token)
}
