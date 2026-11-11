// publik build (PUBLIK-BUILD.md): VoiceStudio opens with Sign in with publik. These checks keep
// the gate in front of every first screen of the app, and keep the module what publik's scan reads.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (file: string) => readFileSync(resolve(process.cwd(), file), 'utf8');

describe('publik gate', () => {
  it('runs before the backend, the runtime install, the permissions and the app window', () => {
    const entry = read('src/main/index.ts');
    const ready = entry.indexOf('.whenReady()');
    const gate = entry.indexOf('await ensureSignedIn(publikGate);');
    expect(ready).toBeGreaterThan(0);
    expect(gate).toBeGreaterThan(ready);
    for (const later of [
      'installRendererPermissions(',
      'new BackendSupervisor()',
      'startAccount(',
      'new DesktopUpdater()',
      'mainWindow = createWindow();',
      'backend.start()',
    ]) {
      const at = entry.indexOf(later, ready);
      expect(at, later).toBeGreaterThan(gate);
    }
    // The planned close of the gate window must not quit the app on Windows and Linux.
    expect(entry).toContain("if (appWindowCreated && process.platform !== 'darwin') app.quit();");
  });

  it('is the one publik module, with the strings the publik scan reads', () => {
    const source = read('src/main/publik.ts');
    expect(source).toContain('export const APP_SLUG = "voicestudio";');
    expect(source).toContain('export const USES_AI: boolean = false;');
    for (const needle of ['/api/v1/installs', '/api/v1/telemetry', '"app_opened"', '/api/v1/wallet']) {
      expect(source).toContain(needle);
    }
    expect(source).toContain(
      'This app uses your publik account. Click Sign in with publik, then sign in in your browser. This window continues when you are signed in.',
    );
    // One client only: the telemetry v1 client of 0.5.7-publik.1 is gone.
    expect(read('src/main/index.ts')).not.toContain('publik-telemetry.cjs');
  });
});
