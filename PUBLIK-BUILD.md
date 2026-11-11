# publik build of VoiceStudio

This repository is a fork of [debpalash/VoiceStudio](https://github.com/debpalash/VoiceStudio).
publik (https://publikhq.com) builds it, signs it and lists it at https://publikhq.com/voicestudio.
It is not an official VoiceStudio release. For VoiceStudio itself, go to the upstream repository.

## What this fork changes

The source is upstream tag `v0.5.7` (commit `beeaae08204f0de5f49d4a087ef2b0ea8fecfcb9`) plus the changes on the branch `telemetry/v1`:

| Change | Files |
|---|---|
| Sign in with publik when the desktop app starts, and usage counts (the publik module) | `electron/src/main/publik.ts`, `electron/src/main/publik-gate.ts`, `electron/src/main/publik-gate-preload.cjs`, `electron/src/main/index.ts`, `electron/src/main/publik-gate-order.test.ts`, `electron/electron-builder.config.mjs`, `.gitignore` |
| A build workflow for this fork, with launch checks against a fake publik | `.github/workflows/publik-build.yml`, `.github/scripts/publik-self-test.cjs`, `.github/scripts/publik-gate-smoke.mjs` |
| No workflow starts from a tag or from a published release | `.github/workflows/electron-release.yml`, `snap-store.yml`, `docker.yml` |
| This note and a README section | `PUBLIK-BUILD.md`, `README.md` |

Nothing else is changed. The app version stays `0.5.7`.

## Releases of this fork

| Tag | What changed |
|---|---|
| `v0.5.7-publik.2` | The app opens with Sign in with publik. The publik module replaces the telemetry v1 client: one file holds the sign-in and the usage counts, and a count carries this computer's publik key. |
| `v0.5.7-publik.1` | Usage counts (publik telemetry v1), with a random install ID only. |

## Sign in with publik

The desktop app opens with a small window: **Sign in with publik**. It comes before every screen of VoiceStudio, also before "Install local runtime".

1. Click **Sign in with publik**. Your browser opens the publik sign-in page.
2. Sign in there. The window checks every 3 seconds, for at most 10 minutes, and continues by itself when you are signed in.
3. VoiceStudio then starts as before.

If publik is not reachable, the window says "publik is not reachable. Check your connection." and shows **Retry**. If you close the window before you sign in, VoiceStudio quits. There is no other way past the window.

VoiceStudio uses no publik AI service: its models run on your computer. So the window shows only the sign-in. It shows no plan screen and asks for no key.

At the first start, the app asks publik for a key for this computer (`POST https://publikhq.com/api/v1/installs`). The request holds the app name (`voicestudio`), the app version, the operating system, the CPU type, the computer name, a random install ID and the build's app token. The key is in `apps/voicestudio.json` in the publik folder of your computer account. On macOS and Linux, only your user account can read the file. The app reads `GET https://publikhq.com/api/v1/wallet` with that key to see if you are signed in.

The publik folder is `~/Library/Application Support/publik` on macOS, `%LOCALAPPDATA%\publik` on Windows and `~/.config/publik` on Linux.

## Usage counts

After the sign-in, the desktop app sends two events to `https://publikhq.com/api/v1/telemetry`:

- `app_opened`: one time for each launch.
- `active_session`: every 30 minutes while the app runs.

Each event holds the app name (`voicestudio`), the app version, the operating system, the CPU type and a random install ID. It carries this computer's publik key, so publik counts a signed-in person one time. It holds nothing else: no audio, no text, no file names.
The install ID is in `telemetry.json` in the publik folder.

To turn the counts off, use one of these:

- Set `DO_NOT_TRACK=1` in the environment.
- Set `PUBLIK_TELEMETRY=0` in the environment.
- Put `{"usage": false}` in `consent.json` in the publik folder.

The sign-in stays when the counts are off.

Details: https://publikhq.com/skills/telemetry.md

## What is different from the upstream downloads

- The app opens with Sign in with publik (see above). Upstream has no such window.
- macOS: publik signs the app with its own Developer ID (team `R5R3ZS54LV`) and Apple notarizes it. Upstream signs its downloads with its own certificate.
- Windows: the installer is not code-signed.
- VoiceStudio's own analytics (PostHog) stays opt-in, as upstream. The upstream release build gets its project token from a build secret. This fork does not have that secret, so the build uses the default token that is in the source.
- Updates: the app still reads the upstream update feed (`https://github.com/debpalash/VoiceStudio/releases/latest/download`). This fork does not publish its own update feed. An update from that feed installs the upstream build, which has no Sign in with publik and no publik usage counts. On macOS such an update can fail, because the upstream build has a different signature.

## Source and license

The license is [AGPL-3.0](LICENSE), the same as upstream. The complete source of this build is this repository:

- https://github.com/Blueturboguy07/VoiceStudio/tree/telemetry/v1
- Each release of this fork names its exact commit.

## How it is built

`.github/workflows/publik-build.yml` builds every desktop file on GitHub Actions with the upstream build commands. It writes the publik app token of the listing from the repository secret `PUBLIK_APP_TOKEN` to `electron/publik-app-token.txt`. That file is in `.gitignore`, and electron-builder packs it into `app.asar`. Then each packaged app runs two checks against a fake publik on the build machine:

- `PUBLIK_SELF_TEST=1`: the app must print `publik self-test: ok voicestudio 0.5.7` and exit.
- The launch check: a signed-in start sends one `app_opened` with the key and then starts VoiceStudio; `DO_NOT_TRACK=1` sends nothing; a start that is not signed in stays at the sign-in window.

The macOS app is then signed, notarized and packed on a publik computer. The workflow does not make or publish a release.
