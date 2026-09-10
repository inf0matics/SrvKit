# SrvKit — VPS Setup

SrvKit ships as a single Docker container. It listens on port **3000**, stores
its data in a volume at **`/data`**, and is configured entirely through
environment variables. This guide deploys it on a VPS behind
[Traefik](https://traefik.io) with automatic HTTPS.

## Prerequisites

- A VPS with **Docker** and **Docker Compose**.
- A reverse proxy terminating TLS. The example below uses **Traefik** on an
  external network named `traefik` (the tsp.tools convention). Any proxy works —
  just forward HTTPS to the container's port `3000`.
- A DNS record pointing at the VPS (e.g. `srvkit.example.com`).

## 1. compose.yml

```yaml
services:
  srvkit:
    image: inf0matics/srvkit:latest        # or pin a version, e.g. :v0.0.1
    container_name: srvkit                  # lets `docker exec srvkit …` work
    restart: unless-stopped
    environment:
      # REQUIRED — encrypts backup-target passwords at rest. Use a long random
      # value and NEVER change it, or existing secrets become unreadable.
      ENCRYPTION_KEY: "change-me-to-a-long-random-secret"
      # Optional overrides (defaults shown):
      # DATABASE_PATH: "/data/srvkit.db"
      # BACKUP_SOURCES_DIR: "/backups"
      # BACKUP_TARGETS_DIR: "/backup-targets"
      # SESSION_TTL: "86400"               # session inactivity timeout (seconds)
      # TIP_JAR_URL: "https://thespielplatz.com/tip-jar"
      # COOKIE_SECURE: leave UNSET behind TLS (Secure cookies are the default).
    volumes:
      - ./data:/data                        # password hash + targets/jobs DB
      # Mount anything you want to back up read-only under /backups/<name>.
      # Each sub-directory shows up as a source in the backup-job wizard:
      - /root:/backups/root:ro
      - /etc:/backups/etc:ro
      # Destinations for local-directory targets — WRITABLE, note the missing
      # :ro. Ideally a different physical disk than the sources above.
      - /srv/backups:/backup-targets
    networks: [traefik]
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.srvkit.rule=Host(`srvkit.example.com`)"
      - "traefik.http.routers.srvkit.entrypoints=websecure"
      - "traefik.http.routers.srvkit.tls.certresolver=letsencrypt"
      - "traefik.http.services.srvkit.loadbalancer.server.port=3000"

networks:
  traefik:
    external: true
```

> **Without Traefik?** Drop the `labels`/`networks` blocks, put SrvKit behind
> your own proxy, and (only for that proxy) expose the port, e.g.
> `ports: ["127.0.0.1:3000:3000"]`. Terminate TLS at the proxy — over plain
> HTTP the secure session cookie won't be sent, so set `COOKIE_SECURE: "false"`
> for local/non-TLS testing only.

Start it:

```bash
docker compose up -d
```

## 2. First start

Open the service URL. On first start there is **no password** — SrvKit shows a
one-time setup screen with a suggested 12-word passphrase. Accept it, regenerate
it, or type your own, then **Save**.

⚠️ **Write the passphrase down.** There is no recovery from the UI — only the CLI
reset below.

## 3. Configure backups

1. **Add a target** — the destination backups are written to. Two types:
   - **Nextcloud** — host, username, password, and a root folder picked via the
     directory browser. Passwords are encrypted at rest with `ENCRYPTION_KEY`.
   - **Local directory** — a folder inside the writable `/backup-targets` mount,
     picked with the same browser. No credentials, no network; a database dump
     lands on disk in seconds. **This is not an off-site backup** — it survives a
     bad migration or a broken container, not a dead disk. Put it on a different
     physical disk than the data, and keep an off-site target alongside it. Its
     disk usage is covered by Host Monitoring's thresholds for that mount.

     The mount has to exist: SrvKit refuses to write when `/backup-targets` is
     missing rather than creating it, because a forgotten volume would otherwise
     put every backup in the container's own filesystem, where the next `docker
     compose up` destroys it. Use **Test** after adding the target — it writes a
     probe file and reports exactly what a real run would hit.
2. **Add a job** — pick a mounted source under `/backups`, choose which files to
   include, and a destination sub-directory. SrvKit watches the selected files
   and writes a `tar.gz` to the target whenever they change (10s debounce). Use
   **Run Now** to trigger a backup immediately.
3. **Decide what each run does** — one choice on the job:
   - **Overwrite** — one file, replaced every run. Nothing accumulates.
   - **Keep the newest N** — a dated file per run; after a successful run,
     everything older than the N newest is deleted. Minimum 2.
   - **Keep all versions** — a dated file per run, nothing ever deleted.

   Cleanup happens only after a *successful* run, so a failed backup can never
   delete a good one, and only among that job's own archives in its own output
   directory. Saving a new choice deletes nothing — the next successful run does
   the trimming, and it counts archives written before the setting existed.

   Two jobs cannot share a name *and* a destination folder: their archives would
   be indistinguishable and each would delete the other's. Renaming a job leaves
   its old archives in place, no longer counted or removed.

## Environment variables

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `ENCRYPTION_KEY` | **yes** | — | Encrypts stored target passwords. Keep stable. |
| `DATABASE_PATH` | no | `/data/srvkit.db` | SQLite DB location (on the volume). |
| `BACKUP_SOURCES_DIR` | no | `/backups` | Base dir for mounted backup sources. |
| `BACKUP_TARGETS_DIR` | no | `/backup-targets` | Base dir for local-directory targets (mount writable). |
| `SESSION_TTL` | no | `86400` | Session inactivity timeout, in seconds. |
| `COOKIE_SECURE` | no | `true` | Secure session cookie. Leave unset behind TLS. |
| `TIP_JAR_URL` | no | — | Sidebar Tip-Jar link; hidden when unset. |
| `PORT` | no | `3000` | Port the app listens on. |

## Reset the password (CLI)

The password can only be changed from the command line — never over HTTP:

```bash
docker exec srvkit srvkit change-password "your new passphrase"
```

All active sessions are logged out immediately.

## Update

```bash
docker compose pull && docker compose up -d
```

Data in the `./data` directory is preserved across updates.
