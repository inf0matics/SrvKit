# Changelog


## v1.1.0

[compare changes](https://github.com/inf0matics/SrvKit/compare/v1.0.2...v1.1.0)

### 🚀 Enhancements

- Expand the dashboard with status boxes ([cb61334](https://github.com/inf0matics/SrvKit/commit/cb61334))

### 🩹 Fixes

- Read the host mount table from /host/proc/1/mounts ([5b24226](https://github.com/inf0matics/SrvKit/commit/5b24226))

### ❤️ Contributors

- Inf0matics <fil@thespielplatz.com>

## v1.0.2

[compare changes](https://github.com/inf0matics/SrvKit/compare/v1.0.1...v1.0.2)

### 🩹 Fixes

- Fall back to /host/proc/mounts for disk discovery (no mtab mount needed) ([07cef6a](https://github.com/inf0matics/SrvKit/commit/07cef6a))

### ❤️ Contributors

- Inf0matics <fil@thespielplatz.com>

## v1.0.1

[compare changes](https://github.com/inf0matics/SrvKit/compare/v1.0.0...v1.0.1)

### 🩹 Fixes

- Filter the host disk list to real partitions only (spec 12.03) ([1549695](https://github.com/inf0matics/SrvKit/commit/1549695))
- Widen sidebar so "Host monitoring" + badge fit on one line ([45eb39c](https://github.com/inf0matics/SrvKit/commit/45eb39c))

### 🏡 Chore

- Sync package-lock version to 1.0.0 ([e898663](https://github.com/inf0matics/SrvKit/commit/e898663))

### ❤️ Contributors

- Inf0matics <fil@thespielplatz.com>

## v1.0.0

[compare changes](https://github.com/inf0matics/SrvKit/compare/v0.0.11...v1.0.0)

🎉 First stable release — SrvKit 1.0.

No functional changes since v0.0.11; this marks the 1.0 milestone. The release covers host monitoring, Docker service monitoring, automated backups (files / SQLite / PostgreSQL / MySQL), peer heartbeat, and Telegram + Nextcloud Talk alerting, with the security-audit hardening applied.


## v0.0.11

[compare changes](https://github.com/inf0matics/SrvKit/compare/v0.0.10...v0.0.11)

### 🩹 Fixes

- Address security-audit findings H1, M1, M4, L1–L3 (safe set) ([a04e7a3](https://github.com/inf0matics/SrvKit/commit/a04e7a3))
- SSRF host block (M3) + HKDF key derivation (L4), no re-encryption ([9de53ec](https://github.com/inf0matics/SrvKit/commit/9de53ec))

### 🏡 Chore

- Scrub demo chat ID/token from screenshot seed + image ([acfa33b](https://github.com/inf0matics/SrvKit/commit/acfa33b))
- Remove the security audit report from the repo ([1d783d8](https://github.com/inf0matics/SrvKit/commit/1d783d8))

### ❤️ Contributors

- Inf0matics <fil@thespielplatz.com>

## v0.0.10

[compare changes](https://github.com/inf0matics/SrvKit/compare/v0.0.9...v0.0.10)

### 🚀 Enhancements

- Add Nextcloud Talk as a second alert channel (spec 16) ([6d792b6](https://github.com/inf0matics/SrvKit/commit/6d792b6))
- Talk bot setup — placeholder URL + generate-secret button ([92b5703](https://github.com/inf0matics/SrvKit/commit/92b5703))

### 🩹 Fixes

- Sign Nextcloud Talk requests with HMAC-SHA256, not Bearer (spec 16.01) ([f16dcf8](https://github.com/inf0matics/SrvKit/commit/f16dcf8))

### ❤️ Contributors

- Inf0matics <fil@thespielplatz.com>

## v0.0.9

[compare changes](https://github.com/inf0matics/SrvKit/compare/v0.0.8...v0.0.9)

### 🚀 Enhancements

- Encrypt peer tokens at rest + IP allowlist toggle (spec 15.01) ([20af747](https://github.com/inf0matics/SrvKit/commit/20af747))

### 📖 Documentation

- Add a "how peer heartbeat works" info box to the Peers page ([f7fbe29](https://github.com/inf0matics/SrvKit/commit/f7fbe29))
- Use a ./data bind mount instead of a named volume in compose examples ([f2d0626](https://github.com/inf0matics/SrvKit/commit/f2d0626))
- Add Docker count, Peer Heartbeat, and Alerting feature sections to the README ([e455500](https://github.com/inf0matics/SrvKit/commit/e455500))
- Add README screenshots + a reproducible Playwright capture harness ([a54e728](https://github.com/inf0matics/SrvKit/commit/a54e728))

### ❤️ Contributors

- Inf0matics <fil@thespielplatz.com>

## v0.0.8

[compare changes](https://github.com/inf0matics/SrvKit/compare/v0.0.7...v0.0.8)

### 🚀 Enhancements

- Filter the DB container dropdown by image (spec 11.03) ([3b46802](https://github.com/inf0matics/SrvKit/commit/3b46802))
- Replace per-job mute with an enable/disable toggle (spec 07.01) ([a277524](https://github.com/inf0matics/SrvKit/commit/a277524))
- Require N consecutive over-threshold polls before host WARN/CRIT (spec 12.02) ([cbd3abb](https://github.com/inf0matics/SrvKit/commit/cbd3abb))
- Docker service monitoring with per-container grace periods (spec 14) ([de3cc7f](https://github.com/inf0matics/SrvKit/commit/de3cc7f))
- Docker runtime discovery, count summary + removed→CRIT (spec 14.01) ([111497f](https://github.com/inf0matics/SrvKit/commit/111497f))
- Sidebar status badges + Docker count-alert info (spec 02.04) ([6e8a618](https://github.com/inf0matics/SrvKit/commit/6e8a618))
- Peer heartbeat monitoring (spec 15) ([59c9a7f](https://github.com/inf0matics/SrvKit/commit/59c9a7f))

### 📖 Documentation

- Explain outage detection on the Docker page (info box) ([47137b6](https://github.com/inf0matics/SrvKit/commit/47137b6))

### 🎨 Styles

- Render the optional disk-mount notice as a standard warning box ([1997852](https://github.com/inf0matics/SrvKit/commit/1997852))
- Use the info icon on required missing-mount notices too ([f8daf24](https://github.com/inf0matics/SrvKit/commit/f8daf24))
- Italicize non-running counts + info icon on the Docker count hint ([a4af910](https://github.com/inf0matics/SrvKit/commit/a4af910))
- Move Peers below Backups in the sidebar ([45c0f04](https://github.com/inf0matics/SrvKit/commit/45c0f04))

### ❤️ Contributors

- Inf0matics <fil@thespielplatz.com>

## v0.0.7

[compare changes](https://github.com/inf0matics/SrvKit/compare/v0.0.6...v0.0.7)

### 🚀 Enhancements

- Host monitoring — /proc metrics, thresholds, sidebar badge (spec 12, core slice) ([9122f2b](https://github.com/inf0matics/SrvKit/commit/9122f2b))
- Host monitoring — disk + network metrics (spec 12, 2nd patch) ([01c65ac](https://github.com/inf0matics/SrvKit/commit/01c65ac))
- Label the host-root mount as optional (disk-only) ([284ef14](https://github.com/inf0matics/SrvKit/commit/284ef14))
- MySQL backup job type (spec 13) ([555059c](https://github.com/inf0matics/SrvKit/commit/555059c))

### 💅 Refactors

- Remove topbar settings cog; move Host monitoring under Dashboard ([ae9084a](https://github.com/inf0matics/SrvKit/commit/ae9084a))
- Remove content-area topbar; muted-jobs badge moves to Alerts nav ([8afea65](https://github.com/inf0matics/SrvKit/commit/8afea65))
- Host page shows each missing-mount warning before its own section ([f294df9](https://github.com/inf0matics/SrvKit/commit/f294df9))

### ✅ Tests

- **e2e:** Comprehensive host monitoring coverage (spec 12.01) ([c350580](https://github.com/inf0matics/SrvKit/commit/c350580))

### ❤️ Contributors

- Inf0matics <fil@thespielplatz.com>

## v0.0.6

[compare changes](https://github.com/inf0matics/SrvKit/compare/v0.0.5...v0.0.6)

### 🚀 Enhancements

- Cron field UX, job-row next run, PG create gating (07.01, 11.01, 11.02) ([dfc6d20](https://github.com/inf0matics/SrvKit/commit/dfc6d20))
- Job-row status — short timestamps + dedicated error area (07.02) ([80dcc9d](https://github.com/inf0matics/SrvKit/commit/80dcc9d))

### 🩹 Fixes

- Cron next-run uses the server timezone; date as DD.MM.YYYY ([c5c84c7](https://github.com/inf0matics/SrvKit/commit/c5c84c7))

### ❤️ Contributors

- Inf0matics <fil@thespielplatz.com>

## v0.0.5

[compare changes](https://github.com/inf0matics/SrvKit/compare/v0.0.4...v0.0.5)

### 🚀 Enhancements

- SQLite cron trigger + WAL auto-detection (spec 08.02) ([5bcbece](https://github.com/inf0matics/SrvKit/commit/5bcbece))
- Dynamic browser tab titles (spec 02.03) ([bfd2423](https://github.com/inf0matics/SrvKit/commit/bfd2423))

### 🩹 Fixes

- Send Telegram alerts as plain text (drop Markdown parse_mode) ([9dec49c](https://github.com/inf0matics/SrvKit/commit/9dec49c))

### ❤️ Contributors

- Inf0matics <fil@thespielplatz.com>

## v0.0.4

[compare changes](https://github.com/inf0matics/SrvKit/compare/v0.0.3...v0.0.4)

### 🚀 Enhancements

- Partial-selection indicator on folders in the job file tree ([a7ad6d4](https://github.com/inf0matics/SrvKit/commit/a7ad6d4))
- PostgreSQL backup job type (spec 11) ([4dd76d3](https://github.com/inf0matics/SrvKit/commit/4dd76d3))

### 🩹 Fixes

- Test alert uses the server-name prefix like real alerts ([4dc6a34](https://github.com/inf0matics/SrvKit/commit/4dc6a34))

### ❤️ Contributors

- Inf0matics <fil@thespielplatz.com>

## v0.0.3

[compare changes](https://github.com/inf0matics/SrvKit/compare/v0.0.2...v0.0.3)

### 🚀 Enhancements

- SQLite backup job type (spec 08) ([7993ae4](https://github.com/inf0matics/SrvKit/commit/7993ae4))
- Lazy file tree + SQLite file picker & validation (05.04, 08.01) ([b4268f2](https://github.com/inf0matics/SrvKit/commit/b4268f2))
- Unified job flow — minimal modal, activation lifecycle, includes model (05.05) ([db93add](https://github.com/inf0matics/SrvKit/commit/db93add))
- Time-suffix toggle, static shell logo, favicon ([1b93b66](https://github.com/inf0matics/SrvKit/commit/1b93b66))
- Alerting v1 — Telegram channel, state machine, per-job muting (spec 09) ([b67ce2f](https://github.com/inf0matics/SrvKit/commit/b67ce2f))
- Dedicated Alerts page, channel on/off switch, server-name message prefix ([6c2adf7](https://github.com/inf0matics/SrvKit/commit/6c2adf7))
- Dashboard incident list (spec 10) ([212653f](https://github.com/inf0matics/SrvKit/commit/212653f))

### ❤️ Contributors

- Inf0matics <fil@thespielplatz.com>

## v0.0.2


### 🚀 Enhancements

- Scaffold SrvKit hello-world on Nuxt 4 ([c3c4aa5](https://github.com/inf0matics/SrvKit/commit/c3c4aa5))
- Initial setup & password authentication ([a4d9f9a](https://github.com/inf0matics/SrvKit/commit/a4d9f9a))
- App shell with sidebar and dashboard route ([4f368a8](https://github.com/inf0matics/SrvKit/commit/4f368a8))
- Landing page redesign for login/setup screen ([e3b3dcb](https://github.com/inf0matics/SrvKit/commit/e3b3dcb))
- Sidebar bottom nav (logout, theme, tip jar, github, version) ([ae5bcd8](https://github.com/inf0matics/SrvKit/commit/ae5bcd8))
- Logout icon + version badge in sidebar ([a0dd464](https://github.com/inf0matics/SrvKit/commit/a0dd464))
- Landing tweaks — icon left of wordmark, dot, footer links ([4832d7a](https://github.com/inf0matics/SrvKit/commit/4832d7a))
- Animate the icon's heartbeat trace ([348bf95](https://github.com/inf0matics/SrvKit/commit/348bf95))
- Faster heartbeat sweep with pause + synced LED blink ([4f1a204](https://github.com/inf0matics/SrvKit/commit/4f1a204))
- Add Backups sidebar entry and route ([70e5c0a](https://github.com/inf0matics/SrvKit/commit/70e5c0a))
- Link sidebar brand to /app ([63dc9e1](https://github.com/inf0matics/SrvKit/commit/63dc9e1))
- Backup targets (Nextcloud WebDAV) ([6501fac](https://github.com/inf0matics/SrvKit/commit/6501fac))
- Test connection button in the Add/Edit Target modal ([c328d1d](https://github.com/inf0matics/SrvKit/commit/c328d1d))
- Add root directory to backup targets ([faa5144](https://github.com/inf0matics/SrvKit/commit/faa5144))
- Pick backup-target root via a directory browser ([4d70d05](https://github.com/inf0matics/SrvKit/commit/4d70d05))
- Files backup job creation wizard ([d424127](https://github.com/inf0matics/SrvKit/commit/d424127))
- Backups sidebar lists targets as sub-items ([a922efa](https://github.com/inf0matics/SrvKit/commit/a922efa))
- Cloud icon before sidebar target sub-items ([c40cc8b](https://github.com/inf0matics/SrvKit/commit/c40cc8b))
- Target page UI refinements (spec 04.04) ([afd5577](https://github.com/inf0matics/SrvKit/commit/afd5577))
- Job type as a muted pill badge ([1827124](https://github.com/inf0matics/SrvKit/commit/1827124))
- Lightweight job-create modal + full edit page (spec 05.02) ([4d945b2](https://github.com/inf0matics/SrvKit/commit/4d945b2))
- Show full destination path with host (spec 05.03) ([fd74ec0](https://github.com/inf0matics/SrvKit/commit/fd74ec0))
- Backup filewatcher + run execution (spec 06) ([c72e795](https://github.com/inf0matics/SrvKit/commit/c72e795))
- Live job run status + 2s polling (spec 07) ([6d9429d](https://github.com/inf0matics/SrvKit/commit/6d9429d))
- Debounce countdown in job row (spec 06.01) ([9fad1fb](https://github.com/inf0matics/SrvKit/commit/9fad1fb))

### 🩹 Fixes

- LED blinks to the light pulse colour instead of dimming ([8a77c57](https://github.com/inf0matics/SrvKit/commit/8a77c57))
- Breadcrumb double slash + monospace selected path ([fa6f68c](https://github.com/inf0matics/SrvKit/commit/fa6f68c))
- No underline on action buttons + plug icon on Test ([0195850](https://github.com/inf0matics/SrvKit/commit/0195850))

### 💅 Refactors

- Align directory browser with spec 04.02 ([ea175c5](https://github.com/inf0matics/SrvKit/commit/ea175c5))
- Split Backups overview and per-target detail (spec 04.03) ([ce7fafe](https://github.com/inf0matics/SrvKit/commit/ce7fafe))

### 📖 Documentation

- Add VPS setup guide + minimal README ([1d2c569](https://github.com/inf0matics/SrvKit/commit/1d2c569))

### 🏡 Chore

- Update tsp.tools design templates ([b7fd298](https://github.com/inf0matics/SrvKit/commit/b7fd298))
- Update SrvKit logo icon ([7cc2c0b](https://github.com/inf0matics/SrvKit/commit/7cc2c0b))

### 🎨 Styles

- Compact job-row destination path (no spaces) ([316a7fb](https://github.com/inf0matics/SrvKit/commit/316a7fb))

### ❤️ Contributors

- Inf0matics <fil@thespielplatz.com>

