// Launch check for the publik usage counts (README, "Usage counts").
//
// Starts the packaged app twice against a listener on 127.0.0.1:
//   1. normal start: exactly one `app_opened` request must arrive and match the contract;
//   2. DO_NOT_TRACK=1: no request may arrive.
// The app gets a temporary home and profile, and its backend is not started.
// Nothing leaves the computer: the endpoint is the local listener.
//
// usage: node publik-telemetry-smoke.mjs --exe <path> --version <x.y.z> [--out <file>] [--wait <s>]
//        [--note <how the app got on disk>] [-- <app args>]
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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
if (!option('exe', '') || !wantVersion) throw new Error('usage: --exe <path> --version <x.y.z>');
if (!existsSync(exe)) throw new Error(`no such executable: ${exe}`);

const received = [];
const server = createServer((req, res) => {
  const chunks = [];
  req.on('data', (chunk) => chunks.push(chunk));
  req.on('end', () => {
    received.push({
      at: new Date().toISOString(),
      method: req.method,
      path: req.url,
      headers: req.headers,
      body: Buffer.concat(chunks).toString('utf8'),
    });
    res.statusCode = 204;
    res.end();
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
async function launch(extraEnv, seconds, stopOnFirstRequest) {
  const home = mkdtempSync(join(tmpdir(), 'publik-smoke-'));
  const before = received.length;
  // A temporary home for the folder that holds telemetry.json (<publik dir>).
  const homeEnv = {
    darwin: { HOME: home, CFFIXED_USER_HOME: home }, // Cocoa paths (logs, caches) follow too
    win32: { LOCALAPPDATA: join(home, 'AppData', 'Local') },
    linux: { HOME: home, XDG_CONFIG_HOME: join(home, '.config') },
  }[process.platform];
  const env = {
    ...process.env,
    ...homeEnv,
    PUBLIK_TELEMETRY_URL: `http://127.0.0.1:${port}/api/v1/telemetry`,
    PUBLIK_TELEMETRY_DEBUG: '1',
    // Keep the launch passive: no backend, no update check, no second-instance hand-off.
    VOICESTUDIO_SKIP_BACKEND: '1',
    VOICESTUDIO_DISABLE_UPDATER: '1',
    VOICESTUDIO_ALLOW_MULTIPLE_INSTANCES: '1',
    OMNIVOICE_PORT: String(port + 1 > 65535 ? port - 1 : port + 1),
    ...extraEnv,
  };
  for (const dir of Object.values(homeEnv)) mkdirSync(dir, { recursive: true });
  delete env.PUBLIK_API_KEY;
  if (!('DO_NOT_TRACK' in extraEnv)) delete env.DO_NOT_TRACK;
  delete env.PUBLIK_TELEMETRY;
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
  const keep = (chunk) => {
    log = (log + chunk.toString()).slice(-6000);
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
    if (stopOnFirstRequest && received.length > before) {
      await sleep(2000); // a second request in this window would be a fault
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
  try {
    rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
  } catch {
    /* a locked profile file on Windows is not a telemetry fault */
  }
  return {
    requests: received.slice(before),
    seconds: Number(((Date.now() - started) / 1000).toFixed(1)),
    aliveAtEnd,
    exitedEarly,
    spawnError,
    installIdFile,
    debugLines: log.split(/\r?\n/).filter((line) => line.includes('publik-telemetry:')),
    logTail: log.split(/\r?\n/).filter((line) => /supervisor|rror/.test(line)).slice(-8),
  };
}

const faults = [];
const check = (ok, message) => {
  if (!ok) faults.push(message);
};

const on = await launch({}, waitSeconds, true);
const opened = on.requests.filter((r) => {
  try {
    return JSON.parse(r.body).event === 'app_opened';
  } catch {
    return false;
  }
});
check(!on.spawnError, `the app did not start: ${on.spawnError}`);
check(on.aliveAtEnd, `the app exited during the check: ${JSON.stringify(on.exitedEarly)}`);
check(on.requests.length === 1, `expected 1 request, got ${on.requests.length}`);
check(opened.length === 1, `expected 1 app_opened, got ${opened.length}`);
let body = null;
if (opened.length >= 1) {
  const request = opened[0];
  body = JSON.parse(request.body);
  const osName = { darwin: 'macos', win32: 'windows', linux: 'linux' }[process.platform];
  const allowed = ['v', 'app', 'install_id', 'event', 'app_version', 'os', 'arch'];
  check(request.method === 'POST', `method is ${request.method}`);
  check(request.path === '/api/v1/telemetry', `path is ${request.path}`);
  check(request.headers['content-type'] === 'application/json', 'Content-Type is not application/json');
  check(!('origin' in request.headers), 'the request has an Origin header (not sent from native code)');
  check(!('authorization' in request.headers), 'a signed-out launch sent an Authorization header');
  check(Object.keys(body).every((key) => allowed.includes(key)), `extra fields: ${Object.keys(body)}`);
  check(body.v === 1, `v is ${body.v}`);
  check(body.app === SLUG, `app is ${body.app}`);
  check(body.event === 'app_opened', `event is ${body.event}`);
  check(body.app_version === wantVersion, `app_version is ${body.app_version}, expected ${wantVersion}`);
  check(body.os === osName, `os is ${body.os}`);
  check(['arm64', 'x64'].includes(body.arch), `arch is ${body.arch}`);
  check(
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(body.install_id),
    `install_id is not a lowercase UUID v4: ${body.install_id}`,
  );
  check(Buffer.byteLength(request.body) <= 2048, 'body is over 2 KB');
  check(on.installIdFile, 'telemetry.json was not created in the temporary home');
}

const off = await launch({ DO_NOT_TRACK: '1' }, Math.min(waitSeconds, 15), false);
check(!off.spawnError, `opt-out launch did not start: ${off.spawnError}`);
check(off.aliveAtEnd, `opt-out launch exited: ${JSON.stringify(off.exitedEarly)}`);
check(off.requests.length === 0, `DO_NOT_TRACK=1 still sent ${off.requests.length} request(s)`);
check(!off.installIdFile, 'DO_NOT_TRACK=1 still created telemetry.json');

server.close();
const report = {
  exe,
  note,
  platform: process.platform,
  arch: process.arch,
  expected: { app: SLUG, app_version: wantVersion },
  normal_launch: on,
  do_not_track_launch: off,
  app_opened_body: body,
  faults,
  result: faults.length === 0 ? 'PASS' : 'FAIL',
};
if (out) writeFileSync(out, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
console.log(`RESULT: ${report.result}`);
process.exit(faults.length === 0 ? 0 : 1);
