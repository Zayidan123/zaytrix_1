#!/usr/bin/env node
// ============================================================================
// ZAYTRIX Automated Browser Smoke Test — QA3-F2
// ----------------------------------------------------------------------------
// Converts the manual agent-browser QA walkthrough (used in QA rounds 1–3)
// into a repeatable script so future rounds / CI can run the same checks:
//
//   1. (optional --boot) spawn the server on a scratch port + health-wait
//   2. open a FRESH browser context (no persisted session)
//   3. register a unique throwaway user through the real UI form
//   4. verify the app shell renders (15 sidebar tabs)
//   5. sweep every tab: click → wait → collect page errors
//   6. final console-error census + screenshot + JSON report
//   7. exit codes: 0 = PASS, 1 = FAIL (errors found), 2 = env problem,
//      3 = auth flow problem (rate limit / form changed)
//
// Usage:
//   node scripts/smoke-test.mjs                          # server already on :3000
//   node scripts/smoke-test.mjs --boot                   # script boots server on :4180
//   node scripts/smoke-test.mjs --url http://localhost:4100
//
// Prerequisites: `agent-browser` CLI on PATH (`npm i -g agent-browser &&
// agent-browser install`). Node 20+ (global fetch).
// Artifacts: ./qa-artifacts/smoke-<ts>.png + smoke-result.json
// ============================================================================
import { spawn, execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------
const args = process.argv.slice(2);
const argValue = (name) => {
  const i = args.indexOf(name);
  return i >= 0 && i + 1 < args.length && !args[i + 1].startsWith("--") ? args[i + 1] : null;
};
const hasFlag = (name) => args.includes(name);

const BASE = argValue("--url") || "http://localhost:3000";
const BOOT = hasFlag("--boot");
const BOOT_PORT = parseInt(argValue("--port") || "4180", 10);
const EMAIL = argValue("--email") || `smoke-${Date.now()}@zaytrix.test`;
const PASSWORD = argValue("--password") || "SmokeTest#2026!A";
const DISPLAY_NAME = argValue("--name") || "Smoke Test Bot";

const TABS = [
  "Dashboard",
  "Coins Rankings",
  "Newsroom Feed",
  "Crypto Hub",
  "On-Chain Data",
  "AI Trade Signals",
  "AI Market Chat",
  "AI Multi-Doc Compare",
  "Profit Projections",
  "Strategy Backtester",
  "Technical Terminal",
  "Trade Automation",
  "Ledger History & Tax",
  "Security & 2FA",
  "Settings Hub",
];

const ART_DIR = new URL("../qa-artifacts/", import.meta.url).pathname;
const TS = new Date().toISOString().replace(/[:.]/g, "-");
const result = {
  startedAt: new Date().toISOString(),
  base: BASE,
  email: EMAIL,
  steps: [],
  tabResults: [],
  pageErrors: 0,
  consoleErrors: 0,
  pass: false,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function ab(cmdArgs, { allowFail = false, timeout = 60000 } = {}) {
  try {
    return execFileSync("agent-browser", cmdArgs, { encoding: "utf8", timeout, stdio: ["ignore", "pipe", "pipe"] });
  } catch (e) {
    if (allowFail) return String(e.stdout || "");
    throw new Error(`agent-browser ${cmdArgs.join(" ")} failed: ${String(e.message).slice(0, 300)}`);
  }
}

const step = (name, ok, detail = "") => {
  result.steps.push({ name, ok, detail: String(detail).slice(0, 400) });
  console.error(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " — " + String(detail).slice(0, 200) : ""}`);
};

async function fetchHealth(base, tries = 30, delayMs = 1000) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(base + "/api/health", { signal: AbortSignal.timeout(2500) });
      if (r.ok) return true;
    } catch { /* retry */ }
    await sleep(delayMs);
  }
  return false;
}

function countErrorLines(text) {
  if (!text) return 0;
  return String(text)
    .split("\n")
    .filter((l) => l.trim().startsWith("[error]") || /^error\b/i.test(l.trim())).length;
}

// Extract a ref from `agent-browser snapshot -i` output by matching an
// accessible-name fragment (e.g. `textbox "Irwan Zayidan"` → ref e8).
// NOTE on the ref regex: the snapshot renders refs as a bare attribute list,
// which may be COMBINED with other flags — e.g. buttons show `[ref=e3]` but
// required inputs show `[required, ref=e8]`. Anchoring on `\[ref=...\]`
// silently fails on the combined form (found the hard way in QA round 3),
// so we simply look for `ref=eN` anywhere in the line.
function refFromSnapshot(snapshotText, pattern) {
  for (const line of String(snapshotText).split("\n")) {
    if (pattern.test(line)) {
      const m = line.match(/ref=(e\d+)/);
      if (m) return m[1];
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
let serverProc = null;
// QA4-F2: temporary .env lifecycle for --boot in CI / fresh checkout.
const ENV_PATH = new URL("../.env", import.meta.url).pathname;
let createdEnvFile = false;


// One full registration attempt through the real UI form. Returns
// { ok, rateLimited, detail }. See main() for the retry/backoff policy.
async function attemptRegistration(email, attempt) {
  // Switch to the register tab.
  ab(["find", "role", "button", "click", "--name", "Daftar Akun"], { allowFail: true, timeout: 30000 });
  await sleep(1200);
  let snap = ab(["snapshot", "-i"], { allowFail: true });
  // NOTE: the AuthScreen inputs are not label-associated, so their accessible
  // names come from the PLACEHOLDERS (verified via snapshot in QA round 3):
  // name → "Irwan Zayidan", email → "zayidan@zaytrix.com",
  // password → "••••••••••••". Patterns tolerate both placeholder- and
  // label-derived names in case the form is upgraded later.
  const nameRef = refFromSnapshot(snap, /Irwan Zayidan|Nama Lengkap/);
  const emailRef = refFromSnapshot(snap, /@zaytrix\.com|Email/);
  if (!nameRef || !emailRef) {
    try { writeFileSync(`${ART_DIR}register-fail-snapshot.txt`, String(snap)); } catch { /* best effort */ }
    return { ok: false, rateLimited: false, detail: "register form not located (full snapshot saved to qa-artifacts/register-fail-snapshot.txt) — excerpt: " + String(snap).replace(/\n/g, " | ").slice(0, 300) };
  }
  // Password field: the bullet-placeholder textbox.
  const pwLine = String(snap)
    .split("\n")
    .filter((l) => /textbox "\u2022|textbox .*[Ss]andi|password/i.test(l))
    .pop();
  const pwMatch = pwLine && pwLine.match(/ref=(e\d+)/);
  ab(["fill", `@${nameRef}`, DISPLAY_NAME]);
  ab(["fill", `@${emailRef}`, email]);
  if (pwMatch) ab(["fill", `@${pwMatch[1]}`, PASSWORD]);
  await sleep(300);
  // Submit: the register submit button. NOTE: match the SUBMIT label
  // ("DAFTAR SEBELUM AKSES" — all caps) precisely; a loose /Daftar/i pattern
  // also matches the "Daftar Akun" TAB-SWITCHER button and clicking that
  // flips the form back to login mode, so the POST never fires (found the
  // hard way in QA round 3).
  const submitLine = String(snap)
    .split("\n")
    .find((l) => /button "DAFTAR SEBELUM AKSES|button "(Buat|Register|Kirim|Simpan) /i.test(l));
  const submitRef = submitLine && submitLine.match(/ref=(e\d+)/);
  if (submitRef) ab(["click", `@${submitRef[1]}`]);
  else ab(["find", "role", "button", "click", "--name", "DAFTAR SEBELUM AKSES"], { allowFail: true });
  // auto-login + app boot + WS connect — poll for the app shell (cold Vite
  // start can exceed a fixed 9s sleep; observed up to ~30s under load).
  for (let i = 0; i < 30; i++) {
    await sleep(1500);
    snap = ab(["snapshot", "-i"], { allowFail: true });
    if (/button "Dashboard"/.test(snap)) return { ok: true, rateLimited: false, detail: `attempt ${attempt}` };
  }
  // Diagnose: was it the rate limiter?
  const netText = ab(["network", "requests", "--filter", "auth"], { allowFail: true });
  const errText = ab(["console"], { allowFail: true });
  const combined = errText + netText;
  const rateLimited = /429|rate|terlalu banyak/i.test(combined);
  const regLine = String(netText).split("\n").find((l) => /POST .*register/.test(l)) || "";
  return {
    ok: false,
    rateLimited,
    detail: rateLimited
      ? "auth rate limit (429)"
      : `register request: ${regLine.trim() || "not observed"} | console: ${String(errText).slice(0, 200)}`,
  };
}

async function main() {
  mkdirSync(ART_DIR, { recursive: true });

  // 1. agent-browser availability
  try {
    execFileSync("agent-browser", ["--version"], { encoding: "utf8", timeout: 15000, stdio: ["ignore", "pipe", "pipe"] });
    step("agent-browser CLI available", true);
  } catch {
    step("agent-browser CLI available", false, "npm i -g agent-browser && agent-browser install");
    process.exit(2);
  }

  // 2. Server health (optionally self-boot)
  let base = BASE;
  // QA5-2: record the ACTUAL browser target (BASE stays the --url default
  // 3000; --boot overrides it with the self-booted port). Previously the
  // report showed the unmodified BASE constant, which was misleading when
  // triaging a failure from a self-booted run.
  if (BOOT) {
    base = `http://localhost:${BOOT_PORT}`;
    result.base = base;
    console.error(`[smoke] booting server on :${BOOT_PORT} …`);
    // CI/fresh-checkout support (QA4-F2): the server refuses to boot without
    // .env (dataRetention validates ENCRYPTION_KEY at module-load — see
    // QA2-1). Mirror vitest globalSetup: create a temporary .env with strong
    // random secrets when none exists, and remove it at teardown. A user's
    // existing .env is NEVER touched.
    if (!existsSync(ENV_PATH)) {
      const secrets = [
        "# TEMPORARY — created by scripts/smoke-test.mjs --boot (removed at teardown)",
        `DATABASE_URL="file:../db/custom.db"`,
        `SESSION_SECRET="${randomBytes(48).toString("hex")}"`,
        `ENCRYPTION_KEY="${randomBytes(32).toString("hex")}"`,
        `CSRF_SECRET="${randomBytes(32).toString("hex")}"`,
        `GEMINI_API_KEY=""`,
        `EMAIL_DEV_MODE="true"`,
        `APP_URL="http://localhost:${BOOT_PORT}"`,
        `PORT="${BOOT_PORT}"`,
        "",
      ].join("\n");
      writeFileSync(ENV_PATH, secrets, "utf8");
      createdEnvFile = true;
      console.error("[smoke] temporary .env created (fresh checkout / CI mode).");
    }
    serverProc = spawn("npx", ["tsx", "server.ts"], {
      cwd: new URL("..", import.meta.url).pathname,
      env: { ...process.env, PORT: String(BOOT_PORT) },
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    });
    serverProc.stdout.on("data", () => {});
    serverProc.stderr.on("data", () => {});
  }
  const healthy = await fetchHealth(base);
  step(`server health ${base}/api/health`, healthy, healthy ? "" : "start the server first (or pass --boot)");
  if (!healthy) {
    finish(2);
    return;
  }

  // 3. Fresh browser context + open. Vite dev cold-start can take >4s to
  //    transform the whole module graph on first load, so POLL for the app
  //    shell (login form OR dashboard) instead of a fixed sleep.
  // NOTE: do NOT call `close` before `open` — relaunching the browser in the
  // same command sequence races and can leave the page on about:blank.
  // Instead: open (launches browser if needed) → clear cookies + storage →
  // reload → poll for the shell. That yields a pristine logged-out state.
  ab(["open", base], { allowFail: true, timeout: 90000 });
  await sleep(2500);
  ab(["cookies", "clear"], { allowFail: true });
  ab(["storage", "local", "clear"], { allowFail: true });
  ab(["reload"], { allowFail: true, timeout: 90000 });
  let snapReady = "";
  for (let i = 0; i < 24; i++) {
    await sleep(1500);
    snapReady = ab(["snapshot", "-i", "-c"], { allowFail: true });
    if (/Daftar Akun|button "Dashboard"/.test(snapReady)) break;
  }
  const title = ab(["get", "title"], { allowFail: true }).trim();
  step("app page title", /ZAYTRIX/i.test(title), title);
  step("app shell became interactive", /Daftar Akun|button "Dashboard"/.test(snapReady));

  // 4. Auth: register a unique user through the real form (fresh context has
  //    no session). If the app shell is already present (persisted state),
  //    skip straight to the sweep. The server's authLimiter allows only 5
  //    auth requests/min/IP (brute-force protection) — if a previous run
  //    saturated it, wait out the 60s window and retry the whole flow once.
  let snap = ab(["snapshot", "-i"], { allowFail: true });
  const alreadyInApp = /button "Dashboard"/.test(snap);
  if (alreadyInApp) {
    step("session already active", true, "app shell detected — skipping registration");
  } else {
    let registered = false;
    for (let attempt = 1; attempt <= 2 && !registered; attempt++) {
      const email = attempt === 1 ? EMAIL : `retry-${Date.now()}@zaytrix.test`;
      const outcome = await attemptRegistration(email, attempt);
      registered = outcome.ok;
      if (!outcome.ok) {
        if (outcome.rateLimited && attempt === 1) {
          console.error("[smoke] auth rate limit hit — waiting 65s for the window to reset …");
          await sleep(65000);
          continue;
        }
        ab(["screenshot", `${ART_DIR}smoke-${TS}.png`], { allowFail: true });
        step("auth failure reason", false, outcome.detail);
        finish(3);
        return;
      }
    }
    step("register + auto-login → app shell", registered);
    if (!registered) { finish(3); return; }
  }

  // 5. Verify all 15 sidebar tabs are present.
  snap = ab(["snapshot", "-i"], { allowFail: true });
  const missingTabs = TABS.filter((t) => !snap.includes(`"${t}`));
  step("15 sidebar tabs present", missingTabs.length === 0, missingTabs.join(", "));

  // 6. Tab sweep — click, wait, count NEW page errors.
  ab(["errors", "--clear"], { allowFail: true });
  for (const tab of TABS) {
    ab(["find", "role", "button", "click", "--name", tab], { allowFail: true, timeout: 45000 });
    await sleep(3600);
    const errCount = countErrorLines(ab(["errors"], { allowFail: true }));
    result.tabResults.push({ tab, pageErrors: errCount });
    console.error(`  ${errCount === 0 ? "ok " : "ERR"} ${tab} (page errors: ${errCount})`);
  }

  // 7. Final console census + screenshot.
  const consoleText = ab(["console"], { allowFail: true, timeout: 30000 });
  result.pageErrors = result.tabResults.reduce((s, t) => s + t.pageErrors, 0);
  result.consoleErrors = countErrorLines(consoleText);
  // Keep the actual error lines for triage (the browser is closed at the end,
  // so the raw console would otherwise be lost).
  result.consoleErrorLines = String(consoleText)
    .split("\n")
    .filter((l) => l.trim().startsWith("[error]"))
    .slice(0, 10);
  ab(["screenshot", `${ART_DIR}smoke-${TS}.png`], { allowFail: true });

  result.pass = result.pageErrors === 0 && result.consoleErrors === 0 && missingTabs.length === 0;
  step(
    "smoke summary",
    result.pass,
    `page errors: ${result.pageErrors}, console errors: ${result.consoleErrors}, missing tabs: ${missingTabs.length}`
  );
  finish(result.pass ? 0 : 1);
}

function finish(code) {
  result.finishedAt = new Date().toISOString();
  try {
    writeFileSync(`${ART_DIR}smoke-result.json`, JSON.stringify(result, null, 2));
  } catch { /* best effort */ }
  if (serverProc) {
    try { process.kill(-serverProc.pid, "SIGTERM"); } catch { /* already gone */ }
  }
  // QA4-F2: remove the temporary .env ONLY if this script created it
  // (fresh checkout / CI mode). A user's own .env is never touched.
  if (createdEnvFile) {
    try { rmSync(ENV_PATH, { force: true }); } catch { /* best effort */ }
  }
  ab(["close"], { allowFail: true });
  console.error(`\n[smoke] ${result.pass ? "PASS ✅" : "FAIL ❌"} — report: qa-artifacts/smoke-result.json`);
  process.exit(code);
}

main().catch((e) => {
  console.error("[smoke] fatal:", e.message);
  finish(1);
});
