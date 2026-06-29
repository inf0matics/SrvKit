# SrvKit

Lightweight DevOps companion for self-hosted servers — host monitoring, Docker service health, and automated backups in a single container.

![Dashboard](docs/screenshots/dashboard.png)

## Features

**Host Monitoring** — CPU, memory, disk, load average, network error rates, and more. Configurable WARN/CRIT thresholds per metric, consecutive-poll smoothing to avoid false alerts.

![Host Monitoring](docs/screenshots/host-monitoring.png)

**Docker Service Monitoring** — tracks running containers via the Docker socket. Alerts when a container stays down beyond its grace period.

![Docker Monitoring](docs/screenshots/docker-monitoring.png)

**Backups** — watch files, SQLite databases, PostgreSQL, or MySQL containers and push compressed archives to a Nextcloud target on schedule or on change.

![Backup Jobs](docs/screenshots/backup-jobs.png)

**Alerting** — Telegram notifications for incidents and recoveries, with a configurable server name prefix.

## Quick start

```yaml
services:
  srvkit:
    image: inf0matics/srvkit:latest
    restart: unless-stopped
    environment:
      ENCRYPTION_KEY: "change-me-to-a-long-random-secret"
    volumes:
      - srvkit-data:/data
      - /proc:/host/proc:ro
      - /sys:/host/sys:ro
      - /etc/mtab:/host/etc/mtab:ro
      - /:/host/root:ro
      - /var/run/docker.sock:/var/run/docker.sock
      - /root:/backups/root:ro
    networks: [traefik]
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.srvkit.rule=Host(`srvkit.example.com`)"
      - "traefik.http.routers.srvkit.entrypoints=websecure"
      - "traefik.http.routers.srvkit.tls.certresolver=letsencrypt"
      - "traefik.http.services.srvkit.loadbalancer.server.port=3000"

volumes:
  srvkit-data:

networks:
  traefik:
    external: true
```

Generate an encryption key:

```bash
echo "ENCRYPTION_KEY=$(openssl rand -base64 32)"
```

Open the service URL — on first start SrvKit shows a one-time passphrase setup screen.

Full setup guide: **[docs/setup.md](docs/setup.md)**

## Volume mounts

| Mount | Purpose | Required |
|---|---|---|
| `srvkit-data:/data` | Database and state | Yes |
| `/proc:/host/proc:ro` | Host metrics (CPU, memory, load) | Host monitoring |
| `/sys:/host/sys:ro` | Host metrics (temperature, I/O) | Host monitoring |
| `/etc/mtab:/host/etc/mtab:ro` | Partition discovery | Host monitoring |
| `/:/host/root:ro` | Disk usage via statvfs | Host monitoring |
| `/var/run/docker.sock:/var/run/docker.sock` | Docker monitoring + DB backups | Docker features |
| `/your/path:/backups/name:ro` | Backup sources | File/SQLite backups |

## Development

```bash
npm install
npm run dev        # http://localhost:<auto-port>
```

Checks: `npm run lint` · `npm run typecheck` · `npm run test:unit` · `npm run test:e2e`
