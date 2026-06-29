# 🔐 Z-Audit Security Report

**Target:** SrvKit — `/Users/fil/Github/TheSpielplatz/SrvKit`
**Date:** 2026-06-29
**Auditor:** Z-Audit (local codebase analysis)
**Stack:** Nuxt 4 (Node 24 / TypeScript) on Nitro/h3 · SQLite (`node:sqlite`) · custom single-password session auth (bcrypt + h3 sessions) · single Docker container behind Traefik · alert channels: Telegram bot API + Nextcloud Talk (HMAC-SHA256)

> Note: the audit found auth is implemented as **custom single-password sessions**, not Logto as the project notes imply — worth reconciling the docs with the implementation.

---

## Remediation status (2026-06-29)

**Fixed:** **H1** (login limiter keys on the unspoofable socket IP), **M1**
(`nitro.sourceMap: false` — 0 server `.map` files), **M3** (`isValidHost` now
blocks loopback/RFC-1918/link-local; `ALLOW_PRIVATE_WEBDAV=1` opts out for LAN
Nextcloud — the audit's SSRF range), **M4** (security headers + tuned CSP via
`routeRules`), **L1** (`isSafeInclude` drops `../`/absolute includes), **L2**
(`/api/heartbeat/pair` rate-limited 20/10 min), **L3** (`timingSafeEqual` for
peer tokens), **L4** (key derivation now **HKDF-SHA256**; new ciphertext is
written `v2:…` while legacy 3-part blobs still decrypt with the old SHA-256 key
— no re-encryption migration, secrets upgrade to v2 on next save). **L5**
verified (direct `esbuild` is the patched `0.28.1`; transitive `0.27.7` is
Vite dev-only and never ships).

**Deferred:** **M2** (non-root container) — for the `./data` bind mount this
needs an entrypoint that chowns `/data` and drops privileges via `gosu`, or a
host-side chown with a pinned UID; held for a separate Dockerfile change.

---

## Executive Summary

SrvKit has a solid security foundation: all SQL is parameterized, secrets are encrypted at rest with AES-256-GCM, session cookies are httpOnly/secure/sameSite=strict, and sensitive tokens are never returned to the client. However, the login rate limiter can be bypassed by spoofing the `X-Forwarded-For` header — even behind Traefik — enabling unlimited brute-force attempts against the single admin password. Four medium-severity issues compound this: source maps ship in the production build, the Dockerfile runs the container as root, the WebDAV host field allows requests to internal addresses (SSRF), and no HTTP security headers are set. Five lower-severity issues round out the findings.

---

## 🟠 High Findings

### H1: Login Rate Limiter Bypassed via X-Forwarded-For Spoofing

- **Location:** `server/api/auth/login.post.ts:15`, `server/utils/srvkit.ts:26`, `lib/rateLimit.ts`
- **Issue:** The rate limiter keys on the client IP from h3's `getRequestIP(event, { xForwardedFor: true })`. h3 v1.15.11 takes the **leftmost** value of `X-Forwarded-For` without verifying it came from a trusted proxy. Traefik (default config) appends the observed IP but does not strip a pre-existing `X-Forwarded-For`. An attacker can therefore set `X-Forwarded-For: <arbitrary-ip>` per request, making each attempt appear to come from a different IP.
- **Impact:** Unlimited password guesses by rotating the header — negating the only brute-force protection on the single admin password. Dictionary/targeted attacks become practical.
- **Evidence:**
  ```typescript
  // server/api/auth/login.post.ts:15
  const ip = getRequestIP(event, { xForwardedFor: true }) || 'unknown'

  // h3 source (node_modules/h3/dist/index.mjs:353):
  const xForwardedFor = getRequestHeader(event, "x-forwarded-for")
    ?.split(",").shift()?.trim();   // takes first value unconditionally

  // server/utils/srvkit.ts:26
  export const loginRateLimiter = createRateLimiter(10, 60_000)
  ```
- **Fix:** Add a second rate-limit key on the unspoofable socket address, or configure Traefik `forwardedHeaders.trustedIPs` and only then trust XFF.
  ```typescript
  // Dual-key: socket-level key is unspoofable
  const sockIp = getRequestIP(event) || 'unknown'
  const xffIp  = getRequestIP(event, { xForwardedFor: true }) || sockIp
  const limit  = loginRateLimiter.check(sockIp)
  ```

---

## 🟡 Medium Findings

### M1: Source Maps Shipped in Production Docker Build

- **Location:** `.output/server/index.mjs.map` + 107 additional `.map` files in `.output/server/`
- **Issue:** The Nitro build emits full source maps for all server bundles, and `COPY --from=build /app/.output /app/.output` copies them into the runtime image.
- **Impact:** If any misconfiguration serves these assets, an attacker retrieves the full TypeScript source (crypto logic, DB schema, query patterns), accelerating vulnerability discovery.
- **Evidence:** `find .output -name "*.map" | wc -l` → `108`
- **Fix:** Add `nitro: { sourceMap: false }` (or `'hidden'`) to `nuxt.config.ts`, or delete `.map` files post-build.

### M2: Dockerfile Runs Container as Root

- **Location:** `Dockerfile`
- **Issue:** No `USER` directive — the container starts as root. The app also expects `/var/run/docker.sock` mounted for container monitoring / DB dumps.
- **Impact:** Any RCE or path-traversal exploit runs as container root; with the Docker socket mounted, that escalates to full host root.
- **Evidence:** No `USER` directive in `Dockerfile`; `CMD [ "node", ".output/server/index.mjs" ]`.
- **Fix:**
  ```dockerfile
  RUN addgroup --system srvkit && adduser --system --ingroup srvkit srvkit
  RUN chown -R srvkit:srvkit /app /data 2>/dev/null || true
  USER srvkit
  ```
  Enforce a read-only (`:ro`) Docker socket mount in docker-compose for monitoring-only deployments.

### M3: WebDAV Target Host Validation Allows Internal SSRF

- **Location:** `server/utils/backups.ts:201`, `server/api/backups/targets/test.post.ts`, `server/api/backups/targets/[id]/browse.post.ts`
- **Issue:** `isValidHost` accepts any `http(s)://.+` URL, letting an authenticated user direct the server at internal addresses (`http://172.17.0.1`, `http://localhost:8080`, `http://169.254.169.254/latest/meta-data/`). `testWebdav`/`browseWebdav` issue PROPFIND/MKCOL with Basic auth and return status + body excerpt.
- **Impact:** Probe internal container networks, enumerate localhost services, and in cloud environments query instance-metadata endpoints for IAM credentials.
- **Evidence:**
  ```typescript
  // server/utils/backups.ts:201
  export function isValidHost(host: string): boolean {
    return /^https?:\/\/.+/.test(host)
  }
  ```
- **Fix:** Require `https://` and block loopback / RFC-1918 / link-local hostnames:
  ```typescript
  import { URL } from 'node:url'
  export function isValidHost(host: string): boolean {
    try {
      const u = new URL(host)
      if (u.protocol !== 'https:') return false
      const h = u.hostname
      if (h === 'localhost' || h === '127.0.0.1' || h === '::1') return false
      if (/^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.)/.test(h)) return false
      return true
    } catch { return false }
  }
  ```

### M4: No HTTP Security Headers

- **Location:** `nuxt.config.ts` (no `routeRules` / `nitro.headers`)
- **Issue:** No `Content-Security-Policy`, `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, or `Permissions-Policy`.
- **Impact:** Any future XSS has full DOM access (no CSP); clickjacking possible (no X-Frame-Options); MIME-sniffing possible (no nosniff).
- **Fix:**
  ```typescript
  routeRules: {
    '/**': {
      headers: {
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'SAMEORIGIN',
        'Referrer-Policy': 'strict-origin-when-cross-origin',
        'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'",
      },
    },
  },
  ```

---

## 🟢 Low Findings

### L1: Job `includes` Paths Not Validated for Path Traversal

- **Location:** `server/utils/runner.ts:90`, `lib/archive.ts:22`, `server/utils/backups.ts:120-122`
- **Issue:** For `files`-type jobs, the user-supplied `includes` array is passed to `tar.create({ cwd: sourceDir }, includes)` without `../` checks. Confirmed: `tar.create({ cwd: '/tmp/test-src' }, ['../test-outside/outside.txt'])` includes the outside file.
- **Impact:** An authenticated admin can back up host files outside the source dir (e.g. `../../etc/passwd`). Self-impact in a single-admin app, but matters if a session is briefly compromised.
- **Fix:** Filter includes — `path.normalize(p)` must not start with `..` and must not be absolute.

### L2: No Rate Limiting on Heartbeat Pairing Endpoint

- **Location:** `server/api/heartbeat/pair.post.ts`, `server/utils/peers.ts:59-72`
- **Issue:** Unauthenticated `/api/heartbeat/pair` has no rate limit. Key is 8 chars / 32-char alphabet (~40 bits), 10-minute window, consumed on first use.
- **Impact:** Practical risk is low given entropy, but no defence if a high request rate is achieved.
- **Fix:** Apply ~20 attempts/IP/10-min via the existing `createRateLimiter`.

### L3: Peer Bearer Token Comparison Not Constant-Time

- **Location:** `server/utils/peers.ts:79`
- **Issue:** `decryptPassword(p.token) === raw` uses `===` (not constant-time).
- **Impact:** Theoretical timing oracle; in practice the AES-GCM decrypt dominates variance, so exploitation is extremely difficult.
- **Fix:** Use `crypto.timingSafeEqual` on equal-length buffers.

### L4: Encryption Key Derived via Raw SHA-256 (No KDF)

- **Location:** `lib/crypto.ts:22-23`
- **Issue:** AES-256 key = `createHash('sha256').update(secret).digest()` — single pass, no salt/iteration/KDF.
- **Impact:** Low if operators follow the docs (long random `ENCRYPTION_KEY`); weaker only with a low-entropy key.
- **Fix:** Use `hkdfSync('sha256', ENCRYPTION_KEY, '', 'srvkit-enc-v1', 32)`. Note: changing derivation invalidates existing ciphertext — requires a re-encrypt migration.

### L5: esbuild Dev Advisory (Dev-Only, Does Not Ship)

- **Location:** `package.json` devDependencies / `npm audit`
- **Issue:** LOW advisory GHSA-g7r4-m6w7-qqqr for esbuild `>=0.27.3 <0.28.1` (Windows dev-server file read). Declared `^0.28.1` already resolves to the fixed release; devDependency only, not in the production image.
- **Impact:** Negligible.
- **Fix:** `npm audit fix`; confirm installed version `>= 0.28.1`.

---

## ✅ What's Secure

- **SQL injection: none found.** All DB access uses bound parameters. The dynamic `UPDATE` in `updateTarget` (`lib/store.ts:457`) builds the `SET` clause from a closed column allowlist — user input never enters SQL structure.
- **Password hashing:** bcrypt cost 12 with a SHA-256 pre-hash (handles >72-byte BIP-39 mnemonics) — `lib/password.ts`.
- **Session security:** cookies `httpOnly`, `secure` (off only when `COOKIE_SECURE=false`), `sameSite: 'strict'`; sealing secret rotates on every password change, invalidating all sessions.
- **Secrets at rest:** AES-256-GCM with random 12-byte IV + auth tag — `lib/crypto.ts`.
- **No secrets in git history:** `.env` gitignored; no real keys/tokens in history. Commit `acfa33b` scrubbed demo credentials.
- **Token non-exposure:** `getAlertSettings()` / `getTalkSettings()` return `hasToken` / `hasSecret` booleans, not the secrets — write-only from the UI.
- **Setup endpoint self-disables:** `/api/auth/setup` returns 404 once a password is set (`server/api/auth/setup.post.ts:7-9`).
- **No shell injection in Docker exec:** `pgDump`/`mysqlDump` use the Docker API `Exec` endpoint with `Cmd: string[]` (`server/utils/docker.ts:162-166`).
- **SQLite path traversal blocked:** `resolveSourcePath` enforces the configured `BACKUP_SOURCES_DIR` prefix (`server/utils/backups.ts:52-57`).
- **Pairing key replay prevented:** `pairPeer` calls `clearPendingKey()` on first match (`server/utils/peers.ts:62`).
- **Rate limiting on login:** 10/min/IP (bypassable — see H1).
- **No devtools in production:** `devtools.enabled` is a dev-only option; disabled under `NODE_ENV=production` (set in the Dockerfile).

---

## 📋 Prioritized Action Plan

### Immediate (today)
1. **H1** — Fix the rate-limiter IP extraction. Add a socket-level key or lock down Traefik `forwardedHeaders.trustedIPs`. ~5-line change.

### This Week
2. **M1** — `nitro: { sourceMap: false }`; rebuild and remove `.map` files from the image.
3. **M2** — Add a non-root `USER` to the Dockerfile; enforce `:ro` Docker socket.
4. **M3** — Block private/loopback addresses in `isValidHost`.
5. **M4** — Add security headers via `routeRules`.

### This Month
6. **L1** — Validate `includes` paths for `../` traversal before storing/running jobs.
7. **L2** — Rate-limit `/api/heartbeat/pair`.
8. **L3** — Switch peer token comparison to `timingSafeEqual`.
9. **L4** — Migrate encryption key derivation to HKDF (coordinated re-encrypt migration).
