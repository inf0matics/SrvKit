# Changelog


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

