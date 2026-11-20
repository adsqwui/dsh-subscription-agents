import { spawn } from 'node:child_process'
import { StringDecoder } from 'node:string_decoder'

const TIMEOUT_MS = 8_000
const MAX_OUTPUT_BYTES = 256 * 1024 // Per stream; stderr is counted but never retained.
const TERMINATE_GRACE_MS = 250
const CLEANUP_TIMEOUT_MS = 750
const INITIALIZE_ID = 1
const REQUEST_ID = 2
const MAX_MODELS = 50
const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:[\]-]{0,99}$/

function windowLabel(minutes, fallback) {
  if (!Number.isSafeInteger(minutes) || minutes <= 0) return fallback
  if (minutes % 1440 === 0) return `${minutes / 1440} d`
  if (minutes % 60 === 0) return `${minutes / 60} h`
  return `${minutes} min`
}

function mapWindows(snapshot) {
  const windows = []
  for (const [key, fallback] of [['primary', 'Primary'], ['secondary', 'Secondary']]) {
    const window = snapshot?.[key]
    const usedPercent = window?.usedPercent
    if (!Number.isFinite(usedPercent) || usedPercent < 0) continue
    const mapped = { label: windowLabel(window.windowDurationMins, fallback), usedPercent }
    // Codex sends Unix seconds; the public usage snapshot uses milliseconds.
    if (Number.isSafeInteger(window.resetsAt) && window.resetsAt > 0 && window.resetsAt <= 8.64e12) {
      mapped.resetAt = window.resetsAt * 1000
    }
    windows.push(mapped)
  }
  return windows
}

function mapUsage(result) {
  // Read the account's main Codex bucket, not model-specific buckets, credits, or plan metadata.
  let windows = mapWindows(result?.rateLimitsByLimitId?.codex)
  if (windows.length === 0) windows = mapWindows(result?.rateLimits)
  return windows.length > 0 ? { updatedAt: Date.now(), windows } : undefined
}

/** Models the account may pick, as Codex lists them; hidden internal models are left out. */
function mapModels(result) {
  if (!Array.isArray(result?.data)) return undefined
  const models = []
  for (const row of result.data) {
    const id = row?.id ?? row?.model
    if (row?.hidden || typeof id !== 'string' || !MODEL_ID.test(id) || models.some(m => m.id === id)) continue
    const name = typeof row.displayName === 'string' && row.displayName.trim() ? row.displayName.replace(/[\x00-\x1f\x7f]/g, '').trim().slice(0, 80) : id
    const inputModalities = Array.isArray(row.inputModalities) && row.inputModalities.includes('image') ? ['text', 'image'] : ['text']
    models.push({ id, name, inputModalities, ...(row.isDefault === true ? { isDefault: true } : {}) })
    if (models.length === MAX_MODELS) break
  }
  return models.length ? models : undefined
}

// Only Codex handles its existing account state. No account/login RPCs, local auth reads,
// or interpretation of errors as login state. Failure is always just unavailable usage.
export function readCodexUsage(options) {
  return appServer(options, 'account/rateLimits/read', undefined, mapUsage)
}

/** The account's model list from `model/list`; a failure yields undefined, never an empty catalog. */
export function readCodexModels(options) {
  return appServer(options, 'model/list', { includeHidden: false, limit: 100 }, mapModels)
}

async function appServer({ exe, argsPrefix = [], env, cwd, signal }, method, params, map) {
  if (!exe || !env || signal?.aborted) return undefined
  let child
  try {
    child = spawn(exe, [...argsPrefix, 'app-server', '--listen', 'stdio://'], {
      cwd,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    })
  } catch {
    return undefined
  }

  return new Promise((resolve) => {
    const decoder = new StringDecoder('utf8')
    let pending = ''
    let stdoutBytes = 0
    let stderrBytes = 0
    let expectedId = INITIALIZE_ID
    let result
    let finishing = false
    let killTimer
    let cleanupTimer
    const timeout = setTimeout(() => finish(), TIMEOUT_MS)

    function abort() { finish() }

    function complete() {
      clearTimeout(killTimer)
      clearTimeout(cleanupTimer)
      resolve(signal?.aborted ? undefined : result)
    }

    function terminate(signalName) {
      if (child.pid && child.exitCode === null && child.signalCode === null) {
        try { child.kill(signalName) } catch { /* No child diagnostics leave this module. */ }
      }
    }

    function finish(value, closed = false) {
      if (finishing) return
      finishing = true
      result = value
      clearTimeout(timeout)
      signal?.removeEventListener('abort', abort)
      pending = ''
      child.stdin.destroy()
      child.stdout.destroy()
      child.stderr.destroy()
      if (closed) return complete()
      terminate('SIGTERM')
      killTimer = setTimeout(() => terminate('SIGKILL'), TERMINATE_GRACE_MS)
      cleanupTimer = setTimeout(() => {
        child.unref()
        complete()
      }, CLEANUP_TIMEOUT_MS)
    }

    function send(...messages) {
      try {
        child.stdin.write(messages.map((message) => JSON.stringify(message) + '\n').join(''))
      } catch {
        finish()
      }
    }

    child.once('close', () => {
      if (finishing) complete()
      else finish(undefined, true)
    })
    child.on('error', () => finish())
    for (const stream of [child.stdin, child.stdout, child.stderr]) {
      stream.on('error', () => finish())
    }
    child.stderr.on('data', (chunk) => {
      stderrBytes += chunk.length
      if (stderrBytes > MAX_OUTPUT_BYTES) finish()
    })
    child.stdout.on('data', (chunk) => {
      stdoutBytes += chunk.length
      if (stdoutBytes > MAX_OUTPUT_BYTES) return finish()
      pending += decoder.write(chunk)
      let newline
      while (!finishing && (newline = pending.indexOf('\n')) !== -1) {
        const line = pending.slice(0, newline)
        pending = pending.slice(newline + 1)
        if (!line.trim()) continue
        let message
        try { message = JSON.parse(line) } catch { return finish() }
        // Notifications and any server-initiated requests are not the response we wait for.
        if (message?.method !== undefined || message?.id !== expectedId) continue
        if (Object.hasOwn(message, 'error') || !message.result || typeof message.result !== 'object') {
          return finish()
        }
        if (expectedId === INITIALIZE_ID) {
          expectedId = REQUEST_ID
          send({ method: 'initialized' }, { id: REQUEST_ID, method, ...(params ? { params } : {}) })
        } else {
          return finish(map(message.result))
        }
      }
    })
    signal?.addEventListener('abort', abort, { once: true })
    if (signal?.aborted) return finish()
    send({
      id: INITIALIZE_ID,
      method: 'initialize',
      params: { clientInfo: { name: 'dsh_subscription_agents', version: '1.0.0' } },
    })
  })
}
