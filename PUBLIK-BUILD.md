# publik build of VoiceStudio

This repository is a fork of [debpalash/VoiceStudio](https://github.com/debpalash/VoiceStudio).
publik (https://publikhq.com) builds it, signs it and lists it at https://publikhq.com/voicestudio.
It is not an official VoiceStudio release. For VoiceStudio itself, go to the upstream repository.

## What this fork changes

The source is upstream tag `v0.5.7` (commit `beeaae08204f0de5f49d4a087ef2b0ea8fecfcb9`) plus the changes on the branch `telemetry/v1`:

| Change | Files |
|---|---|
| Usage counts (publik telemetry v1) in the desktop app | `electron/src/main/publik-telemetry.cjs`, `electron/src/main/index.ts`, `electron/electron-builder.config.mjs` |
| A build workflow for this fork | `.github/workflows/publik-build.yml`, `.github/scripts/publik-telemetry-smoke.mjs` |
| No workflow starts from a tag or from a published release | `.github/workflows/electron-release.yml`, `snap-store.yml`, `docker.yml` |
| This note and a README section | `PUBLIK-BUILD.md`, `README.md` |

Nothing else is changed. The app version stays `0.5.7`. The release tag of this build is `v0.5.7-publik.1`.

## Usage counts

The desktop app sends two events to `https://publikhq.com/api/v1/telemetry`:

- `app_opened`: one time for each launch.
- `active_session`: every 30 minutes while the app runs.

Each event holds the app name (`voicestudio`), the app version, the operating system, the CPU type and a random install ID. It holds nothing else: no audio, no text, no file names, no account data.
The install ID is in `telemetry.json` in the publik folder of your computer account (`~/Library/Application Support/publik` on macOS, `%LOCALAPPDATA%\publik` on Windows, `~/.config/publik` on Linux).

To turn the counts off, use one of these:

- Set `DO_NOT_TRACK=1` in the environment.
- Set `PUBLIK_TELEMETRY=0` in the environment.
- Put `{"usage": false}` in `consent.json` in the publik folder.

Details: https://publikhq.com/skills/telemetry.md

## What is different from the upstream downloads

- macOS: publik signs the app with its own Developer ID (team `R5R3ZS54LV`) and Apple notarizes it. Upstream signs its downloads with its own certificate.
- Windows: the installer is not code-signed.
- VoiceStudio's own analytics (PostHog) stays opt-in, as upstream. The upstream release build gets its project token from a build secret. This fork does not have that secret, so the build uses the default token that is in the source.
- Updates: the app still reads the upstream update feed (`https://github.com/debpalash/VoiceStudio/releases/latest/download`). This fork does not publish its own update feed. An update from that feed installs the upstream build, which has no publik usage counts. On macOS such an update can fail, because the upstream build has a different signature.

## Source and license

The license is [AGPL-3.0](LICENSE), the same as upstream. The complete source of this build is this repository:

- https://github.com/Blueturboguy07/VoiceStudio/tree/telemetry/v1
- Each release of this fork names its exact commit.

## How it is built

`.github/workflows/publik-build.yml` builds every desktop file on GitHub Actions with the upstream build commands. The macOS app is then signed, notarized and packed on a publik computer. The workflow does not make or publish a release.
