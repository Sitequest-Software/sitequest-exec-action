/**
 * Sitequest Exec — GitHub Action entry point.
 *
 * Runs a shell command on a Sitequest VPS or webspace via the v1 REST API.
 * Captures stdout/stderr/exit-code as outputs and writes a job summary.
 */

import * as core from "@actions/core"

const USER_AGENT = "sitequest-exec-action/1.0"
const MAX_TIMEOUT = 300 // server-side cap on both /vps/exec and /webspaces/exec

type Resource = "vps" | "webspace"

/** Resource-type → URL path segment. The API uses singular `vps` and plural `webspaces`. */
const URL_SEGMENT: Record<Resource, string> = {
  vps:      "vps",
  webspace: "webspaces",
}

interface Inputs {
  apiKey:        string
  resource:      Resource
  id:            string
  command:       string
  cwd:           string
  timeout:       number
  failOnNonZero: boolean
  apiBase:       string
}

interface ApiError {
  error:  string
  code:   string
  status: number
}

interface ExecResult {
  stdout:     string
  stderr:     string
  exitCode:   number | null
  durationMs: number
  truncated?: boolean
}

interface ApiEnvelope<T> {
  data: T
}

function readInputs(): Inputs {
  const apiKey   = core.getInput("api-key", { required: true })
  const resource = core.getInput("resource", { required: true }).toLowerCase() as Resource
  const id       = core.getInput("id", { required: true })
  const command  = core.getInput("command", { required: true })
  const cwd      = core.getInput("cwd") || ""
  const timeout  = Number.parseInt(core.getInput("timeout") || "300", 10)
  const fail     = (core.getInput("fail-on-non-zero") || "true").toLowerCase() === "true"
  const apiBase  = (core.getInput("api-base") || "https://hosting.site.quest").replace(/\/+$/, "")

  if (resource !== "vps" && resource !== "webspace") {
    throw new Error(`resource must be 'vps' or 'webspace' (got '${resource}')`)
  }
  if (!/^[A-Za-z0-9_-]+$/.test(id)) {
    throw new Error(`Invalid id: ${id}`)
  }
  if (!command.trim()) {
    throw new Error("command must be non-empty")
  }
  if (!Number.isFinite(timeout) || timeout < 1 || timeout > MAX_TIMEOUT) {
    throw new Error(`timeout must be 1..${MAX_TIMEOUT}`)
  }
  return { apiKey, resource, id, command, cwd, timeout, failOnNonZero: fail, apiBase }
}

async function apiCall<T>(
  url:    string,
  body:   unknown,
  apiKey: string,
): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization:  `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "User-Agent":   USER_AGENT,
    },
    body: JSON.stringify(body),
  })
  const text = await res.text()
  if (!res.ok) {
    let parsed: ApiError | undefined
    try { parsed = JSON.parse(text) as ApiError } catch { /* not JSON */ }
    const code = parsed?.code  ?? `HTTP_${res.status}`
    const msg  = parsed?.error ?? (text.slice(0, 500) || res.statusText)
    throw new Error(`[${code}] ${msg}`)
  }
  return JSON.parse(text) as T
}

/**
 * Build the command string. If `cwd` is set, wrap with `cd <cwd> && …` —
 * single-quote-escaped to neutralise embedded quotes in user-supplied paths.
 */
function buildCommand(command: string, cwd: string): string {
  if (!cwd) return command
  const sh = `'${cwd.replace(/'/g, "'\\''")}'`
  return `cd ${sh} && ${command}`
}

async function main(): Promise<void> {
  const startedAt = Date.now()
  let inputs: Inputs
  try {
    inputs = readInputs()
  } catch (err) {
    core.setFailed((err as Error).message)
    return
  }
  core.setSecret(inputs.apiKey)

  const url = `${inputs.apiBase}/api/v1/${URL_SEGMENT[inputs.resource]}/${inputs.id}/exec`
  const cmd = buildCommand(inputs.command, inputs.cwd)

  core.info(`Executing on ${inputs.resource} ${inputs.id} (timeout ${inputs.timeout}s)`)
  if (inputs.cwd) core.info(`Working directory: ${inputs.cwd}`)

  try {
    const envelope = await apiCall<ApiEnvelope<ExecResult>>(
      url,
      { command: cmd, timeout: inputs.timeout },
      inputs.apiKey,
    )
    const result = envelope.data

    const duration = Date.now() - startedAt
    const exit     = result.exitCode ?? -1

    core.setOutput("exit-code",   exit)
    core.setOutput("stdout",      result.stdout)
    core.setOutput("stderr",      result.stderr)
    core.setOutput("duration-ms", duration)

    if (result.stdout) {
      await core.group("stdout", async () => core.info(result.stdout.trimEnd()))
    }
    if (result.stderr) {
      await core.group("stderr", async () => core.info(result.stderr.trimEnd()))
    }
    if (result.truncated) {
      core.warning("Output was truncated by the API (>2 MB).")
    }

    const secs = (duration / 1000).toFixed(2)
    await core.summary
      .addRaw(`Ran on \`${inputs.resource} ${inputs.id}\` — exit ${exit} in ${secs}s.`)
      .write()

    if (exit !== 0 && inputs.failOnNonZero) {
      core.setFailed(`Remote command exited with code ${exit}`)
      return
    }
    core.info(`✓ Completed in ${secs}s (exit ${exit})`)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    core.setOutput("exit-code", -1)
    core.setFailed(message)
  }
}

void main()
