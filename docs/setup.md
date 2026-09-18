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

## 1. `.env` — the encryption key

SrvKit's only required setting is `ENCRYPTION_KEY`, and it is a secret: it
encrypts backup-target passwords at rest. It belongs in a `.env` file next to
`compose.yml`, not inline in the compose file.

Create the directory and the `.env` in one copy-paste:

```bash
mkdir -p /opt/srvkit && cd /opt/srvkit && { [ -e .env ] && echo "!! .env already exists — leaving it alone" || { umask 077; printf 'ENCRYPTION_KEY=%s\n' "$(openssl rand -base64 32)" > .env; chmod 600 .env; echo "OK  .env created with a fresh ENCRYPTION_KEY"; }; }
```

What it does: creates `/opt/srvkit`, generates a 256-bit random key with
`openssl`, and writes it to a `.env` readable only by its owner (`umask 077` +
`chmod 600`). It **refuses to overwrite an existing `.env`** — regenerating the
key over a live install makes every stored target password undecryptable.

⚠️ **Back up this file.** The key must stay stable for the life of the install.
`.env` holds a secret — never commit it. Add any optional overrides from the
[table below](#environment-variables) as further lines in the same file.

## 2. compose.yml

```yaml
services:
  srvkit:
    image: thespielplatz/srvkit:latest      # or pin a version, e.g. :v1.5.0
    container_name: srvkit                  # lets `docker exec srvkit …` work
    restart: unless-stopped
    # Reads ./.env — ENCRYPTION_KEY and any optional overrides you put there.
    env_file:
      - .env
    environment:
      # Fail fast with a readable message if the .env is missing or the key is
      # empty, instead of starting a container that cannot decrypt anything.
      ENCRYPTION_KEY: ${ENCRYPTION_KEY:?missing — run the .env command in step 1}
    volumes:
      - ./data:/data                        # password hash + targets/jobs DB
      # Mount anything you want to back up read-only under /backups/<name>.
      # Each sub-directory shows up as a source in the backup-job wizard:
      - /root:/backups/root:ro
      - /etc:/backups/etc:ro
      # Host monitoring:
      - /proc:/host/proc:ro
      - /sys:/host/sys:ro
      - /etc/mtab:/host/etc/mtab:ro
      - /:/host/root:ro
      # Docker monitoring + database backup jobs:
      - /var/run/docker.sock:/var/run/docker.sock
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

Two things pull the key in, and they do different jobs: `env_file` hands the
whole `.env` to the *container*, while `${ENCRYPTION_KEY:?…}` is substituted by
*Compose itself* on the host — that is what turns a missing `.env` into an
error at `docker compose up` rather than a container that boots and then fails
on the first saved password.

> **Without Traefik?** Drop the `labels`/`networks` blocks, put SrvKit behind
> your own proxy, and (only for that proxy) expose the port, e.g.
> `ports: ["127.0.0.1:3000:3000"]`. Terminate TLS at the proxy — over plain
> HTTP the secure session cookie won't be sent, so set `COOKIE_SECURE: "false"`
> for local/non-TLS testing only.

Start it:

```bash
docker compose up -d
```

## 3. First start

Open the service URL. On first start there is **no password** — SrvKit shows a
one-time setup screen with a suggested 12-word passphrase. Accept it, regenerate
it, or type your own, then **Save**.

⚠️ **Write the passphrase down.** There is no recovery from the UI — only the CLI
reset below.

## 4. Configure backups

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
3. **Backup rotation** — what SrvKit does with a job's older archives:
   - **Off** — SrvKit deletes nothing. The two filename checkboxes below the box
     decide whether a run overwrites the last file or adds another one, so
     "keep every version forever" is Off with both of them ticked.
   - **Keep the newest N** — every run is its own file; after a successful run,
     everything older than the N newest is deleted. Minimum 2.

   Keeping the newest N switches the date and time suffixes on and locks them: a
   version you cannot tell apart from the last one is not a version. Under Off
   the checkboxes are yours, and the time can only be added together with the
   date.

   **Newest is decided by the date in the filename**, never by the file's
   timestamp — a modification time is rewritten by WebDAV uploads and by any
   restore or copy, which would make the rotation delete near-randomly after you
   move your backups. Only files matching that job's own
   `<name>_YYYY-MM-DD[_HH-MM-SS].tar.gz` pattern are counted or removed;
   anything else in the folder is invisible to it.

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
| `ENCRYPTION_KEY` | **yes** | — | Encrypts stored target passwords. Keep stable. Lives in `.env` (step 1). |
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
