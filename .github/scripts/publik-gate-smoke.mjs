// Launch check for the publik gate and the usage counts (README, "Sign in with publik and usage
// counts"). CI only; not part of the app.
//
// Starts the packaged app three times against a fake publik on 127.0.0.1 (PUBLIK_ORIGIN):
//   1. signed in: the gate passes at once. POST /installs (with the baked pat_ app token),
//      GET /wallet (with the install key), then exactly one `app_opened` on POST /telemetry with
//      the install key, and VoiceStudio's own start-up runs ("[supervisor] backend root").
//   2. signed in, DO_NOT_TRACK=1: the gate passes, no request reaches /telemetry, no telemetry.json.
//   3. not signed in: the gate waits. GET /wallet is polled, nothing reaches /telemetry, and
//      VoiceStudio's own start-up (backend, runtime install, app window) does not run.
// The app gets a temporary home and profile, and its backend is not started.
// Nothing leaves the computer: every request goes to the fake publik. The app token is never printed.
//
// usage: node publik-gate-smoke.mjs --exe <path> --version <x.y.z> [--out <file>] [--wait <s>]
//        [--note <how the app got on disk>] [-- <app args>]
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const argv = process.argv.slice(2);
const split = argv.indexOf('--');
const own = split >= 0 ? argv.slice(0, split) : argv;
const appArgs = split >= 0 ? argv.slice(split + 1) : [];
const option = (name, fallback) => {
  const index = own.indexOf(`--${name}`);
  return index >= 0 ? own[index + 1] : fallback;
};
const exe = resolve(option('exe', ''));
const wantVersion = option('version', '');
const out = option('out', '');
const waitSeconds = Number(option('wait', '30'));
const note = option('note', '');
const SLUG = 'voicestudio';
const KEY = 'pk_live_gatesmoke000_00000000000000000000000000000000'; // the fake key of this fake publik
const STARTED = '[supervisor] backend root'; // the first line of VoiceStudio's own start-up
const UUID4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
if (!option('exe', '') || !wantVersion) throw new Error('usage: --exe <path> --version <x.y.z>');
if (!existsSync(exe)) throw new Error(`no such executable: ${exe}`);

let claimState = 'claimed';
const received = [];
const server = createServer((req, res) => {
  const chunks = [];
  req.on('data', (chunk) => chunks.push(chunk));
  req.on('end', () => {
    const body = Buffer.concat(chunks).toString('utf8');
    received.push({ at: new Date().toISOString(), method: req.method, path: req.url, headers: req.headers, body });
    const json = (status, data) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(data));
    };
    const origin = `http://127.0.0.1:${server.address().port}`;
    if (req.method === 'POST' && req.url === '/api/v1/installs') {
      let installId = '';
      try {
        installId = JSON.parse(body).install_id;
      } catch {
        /* checked below */
      }
      return json(201, { key: KEY, install_id: installId, claim_url: `${origin}/claim/x`, claim_state: 'anonymous', base_url: `${origin}/api/v1` });
    }
    if (req.method === 'GET' && req.url === '/api/v1/wallet') {
      return json(200, {
        claim_state: claimState,
        claim_url: claimState === 'claimed' ? null : `${origin}/claim/x`,
        account: claimState === 'claimed' ? { handle: 'ci' } : null,
        plan: { kind: 'none', label: null },
        balance_micros: 0,
        top_up_url: `${origin}/wallet`,
        linked_at: null,
      });
    }
    if (req.method === 'POST' && req.url === '/api/v1/telemetry') {
      res.statusCode = 204;
      return res.end();
    }
    json(404, {});
  });
});
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const port = server.address().port;
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

function stop(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    return;
  }
  for (const signal of ['SIGTERM', 'SIGKILL']) {
    try {
      process.kill(-child.pid, signal);
    } catch {
      /* the process group is gone */
    }
    if (signal === 'SIGTERM') spawnSync('sleep', ['3']);
  }
}

/** One launch. Resolves with what arrived and how the process behaved. */
async function launch({ state, extraEnv = {}, seconds, until = null }) {
  claimState = state;
  const home = mkdtempSync(join(tmpdir(), 'publik-gate-smoke-'));
  const before = received.length;
  // A temporary home for the publik folder (credential, telemetry.json).
  const homeEnv = {
    darwin: { HOME: home, CFFIXED_USER_HOME: home }, // Cocoa paths (logs, caches) follow too
    win32: { LOCALAPPDATA: join(home, 'AppData', 'Local') },
    linux: { HOME: home, XDG_CONFIG_HOME: join(home, '.config') },
  }[process.platform];
  const env = {
    ...process.env,
    ...homeEnv,
    PUBLIK_ORIGIN: `http://127.0.0.1:${port}`,
    PUBLIK_TELEMETRY_DEBUG: '1',
    // Keep the launch passive: no backend, no update check, no second-instance hand-off.
    VOICESTUDIO_SKIP_BACKEND: '1',
    VOICESTUDIO_DISABLE_UPDATER: '1',
    VOICESTUDIO_ALLOW_MULTIPLE_INSTANCES: '1',
    OMNIVOICE_PORT: String(port + 1 > 65535 ? port - 1 : port + 1),
    ...extraEnv,
  };
  for (const dir of Object.values(homeEnv)) mkdirSync(dir, { recursive: true });
  for (const name of ['PUBLIK_API_KEY', 'PUBLIK_APP_TOKEN', 'PUBLIK_TELEMETRY', 'PUBLIK_TELEMETRY_URL', 'PUBLIK_SELF_TEST']) delete env[name];
  if (!('DO_NOT_TRACK' in extraEnv)) delete env.DO_NOT_TRACK;
  // No keychain item on macOS; the Chromium sandbox needs a setuid helper that a
  // mounted AppImage on a CI runner does not have.
  const platformArgs = { darwin: ['--use-mock-keychain'], linux: ['--no-sandbox'] }[process.platform] ?? [];
  const child = spawn(exe, [`--user-data-dir=${join(home, 'profile')}`, ...platformArgs, ...appArgs], {
    env,
    detached: process.platform !== 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  let log = '';
  let sawStarted = false;
  const keep = (chunk) => {
    log = (log + chunk.toString()).slice(-20000);
    if (log.includes(STARTED)) sawStarted = true;
  };
  child.stdout.on('data', keep);
  child.stderr.on('data', keep);
  let spawnError = null;
  child.once('error', (error) => {
    spawnError = String(error);
  });
  const started = Date.now();
  let exitedEarly = null;
  while (Date.now() - started < seconds * 1000) {
    await sleep(250);
    if (spawnError) break;
    if (child.exitCode !== null || child.signalCode !== null) {
      exitedEarly = { code: child.exitCode, signal: child.signalCode };
      break;
    }
    if (until && until(received.slice(before), sawStarted)) {
      await sleep(3000); // a second app_opened (or a late one) in this window would be a fault
      break;
    }
  }
  const aliveAtEnd = child.exitCode === null && child.signalCode === null && !spawnError;
  stop(child);
  await sleep(500);
  const publikDir =
    process.platform === 'darwin'
      ? join(home, 'Library', 'Application Support', 'publik')
      : process.platform === 'win32'
        ? join(home, 'AppData', 'Local', 'publik')
        : join(home, '.config', 'publik');
  const installIdFile = existsSync(join(publikDir, 'telemetry.json'));
  const credential = join(publikDir, 'apps', `${SLUG}.json`);
  const credentialFile = existsSync(credential);
  const credentialMode = credentialFile && process.platform !== 'win32' ? (statSync(credential).mode & 0o777).toString(8) : null;
  try {
    rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
  } catch {
    /* a locked profile file on Windows is not a gate fault */
  }
  const requests = received.slice(before);
  return {
    requests: requests.map((r) => ({
      at: r.at,
      method: r.method,
      path: r.path,
      authorization: r.headers.authorization === `Bearer ${KEY}` ? 'the install key' : r.headers.authorization ? 'other' : 'none',
      body: r.path === '/api/v1/installs' ? '(installs body: not printed, it holds the app token)' : r.body,
    })),
    raw: requests,
    seconds: Number(((Date.now() - started) / 1000).toFixed(1)),
    aliveAtEnd,
    exitedEarly,
    spawnError,
    installIdFile,
    credentialFile,
    credentialMode,
    appStartedPastGate: sawStarted,
    debugLines: log.split(/\r?\n/).filter((line) => line.includes('publik-telemetry:')),
    logTail: log.split(/\r?\n/).filter((line) => /supervisor|rror|publik/.test(line)).slice(-10),
  };
}

const faults = [];
const check = (ok, message) => {
  if (!ok) faults.push(message);
};
const osName = { darwin: 'macos', win32: 'windows', linux: 'linux' }[process.platform];
const calls = (run, method, path) => run.raw.filter((r) => r.method === method && r.path === path);

// 1. Signed in: the gate passes, the usage count goes out with the install key, the app starts.
const on = await launch({
  state: 'claimed',
  seconds: waitSeconds,
  until: (requests, started) => started && requests.some((r) => r.path === '/api/v1/telemetry'),
});
check(!on.spawnError, `the app did not start: ${on.spawnError}`);
check(on.aliveAtEnd, `the app exited during the check: ${JSON.stringify(on.exitedEarly)}`);
const installs = calls(on, 'POST', '/api/v1/installs');
const wallets = calls(on, 'GET', '/api/v1/wallet');
const events = calls(on, 'POST', '/api/v1/telemetry');
check(installs.length === 1, `expected 1 POST /api/v1/installs, got ${installs.length}`);
check(wallets.length >= 1, 'no GET /api/v1/wallet arrived');
check(wallets.every((r) => r.headers.authorization === `Bearer ${KEY}`), 'GET /wallet does not carry the install key');
let installsBody = null;
if (installs.length >= 1) {
  try {
    installsBody = JSON.parse(installs[0].body);
  } catch {
    faults.push('the installs body is not JSON');
  }
}
if (installsBody) {
  check(String(installsBody.app_token ?? '').startsWith('pat_'), 'installs carries no pat_ app token: the build has none');
  check(installsBody.app_slug === SLUG, `installs app_slug is ${installsBody.app_slug}`);
  check(installsBody.app_version === wantVersion, `installs app_version is ${installsBody.app_version}, expected ${wantVersion}`);
  check(installsBody.os === osName, `installs os is ${installsBody.os}`);
  check(UUID4.test(String(installsBody.install_id)), 'installs install_id is not a UUID v4');
}
check(events.length === 1, `expected 1 POST /api/v1/telemetry, got ${events.length}`);
let body = null;
if (events.length >= 1) {
  const request = events[0];
  try {
    body = JSON.parse(request.body);
  } catch {
    faults.push('the telemetry body is not JSON');
  }
  const allowed = ['v', 'app', 'install_id', 'event', 'app_version', 'os', 'arch'];
  check(request.headers['content-type'] === 'application/json', 'Content-Type is not application/json');
  check(!('origin' in request.headers), 'the request has an Origin header (not sent from native code)');
  check(request.headers.authorization === `Bearer ${KEY}`, 'a signed-in launch sent no install key with app_opened');
  if (body) {
    check(Object.keys(body).every((key) => allowed.includes(key)), `extra fields: ${Object.keys(body)}`);
    check(body.v === 1, `v is ${body.v}`);
    check(body.app === SLUG, `app is ${body.app}`);
    check(body.event === 'app_opened', `event is ${body.event}`);
    check(body.app_version === wantVersion, `app_version is ${body.app_version}, expected ${wantVersion}`);
    check(body.os === osName, `os is ${body.os}`);
    check(['arm64', 'x64'].includes(body.arch), `arch is ${body.arch}`);
    check(UUID4.test(body.install_id), `install_id is not a lowercase UUID v4: ${body.install_id}`);
  }
  check(Buffer.byteLength(request.body) <= 2048, 'body is over 2 KB');
  check(on.installIdFile, 'telemetry.json was not created in the temporary home');
}
if (installs.length && events.length) check(installs[0].at <= events[0].at, 'app_opened came before the sign-in');
check(on.credentialFile, 'the credential file apps/voicestudio.json was not created');
if (on.credentialMode !== null) check(on.credentialMode === '600', `the credential file has mode ${on.credentialMode}, expected 600`);
check(on.appStartedPastGate, `VoiceStudio's own start-up did not run after the sign-in ("${STARTED}" not in the log)`);

// 2. Signed in, DO_NOT_TRACK=1: the gate still passes, no usage count.
const off = await launch({ state: 'claimed', extraEnv: { DO_NOT_TRACK: '1' }, seconds: waitSeconds, until: (_requests, started) => started });
check(!off.spawnError, `opt-out launch did not start: ${off.spawnError}`);
check(off.aliveAtEnd, `opt-out launch exited: ${JSON.stringify(off.exitedEarly)}`);
check(calls(off, 'GET', '/api/v1/wallet').length >= 1, 'opt-out launch: the gate did not read GET /wallet');
check(calls(off, 'POST', '/api/v1/telemetry').length === 0, `DO_NOT_TRACK=1 still sent ${calls(off, 'POST', '/api/v1/telemetry').length} request(s)`);
check(!off.installIdFile, 'DO_NOT_TRACK=1 still created telemetry.json');
check(off.appStartedPastGate, 'opt-out launch: VoiceStudio did not start after the sign-in');

// 3. Not signed in: the gate holds the app. Wait for 4 reads of GET /wallet (the first one and
// three polls, 3 s apart): VoiceStudio's own start-up would have logged by then if it were not held.
const gate = await launch({
  state: 'anonymous',
  seconds: waitSeconds,
  until: (requests) => requests.filter((r) => r.method === 'GET' && r.path === '/api/v1/wallet').length >= 4,
});
check(!gate.spawnError, `gate launch did not start: ${gate.spawnError}`);
check(gate.aliveAtEnd, `gate launch exited (the gate window must wait): ${JSON.stringify(gate.exitedEarly)}`);
check(calls(gate, 'GET', '/api/v1/wallet').length >= 4, `the gate did not poll GET /wallet (got ${calls(gate, 'GET', '/api/v1/wallet').length})`);
check(calls(gate, 'POST', '/api/v1/telemetry').length === 0, 'a launch that is not signed in sent a usage count');
check(!gate.appStartedPastGate, `VoiceStudio's own start-up ran before the sign-in ("${STARTED}" in the log)`);

server.close();
for (const run of [on, off, gate]) delete run.raw;
const report = {
  exe,
  note,
  platform: process.platform,
  arch: process.arch,
  expected: { app: SLUG, app_version: wantVersion },
  signed_in_launch: on,
  do_not_track_launch: off,
  not_signed_in_launch: gate,
  app_opened_body: body,
  faults,
  result: faults.length === 0 ? 'PASS' : 'FAIL',
};
const text = JSON.stringify(report, null, 2).replace(/pat_[A-Za-z0-9_-]+/g, 'pat_(hidden)');
if (out) writeFileSync(out, text + '\n');
console.log(text);
console.log(`RESULT: ${report.result}`);
process.exit(faults.length === 0 ? 0 : 1);
