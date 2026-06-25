# SrvKit

Lightweight DevOps companion — host monitoring, Docker service health, and
automated backups in a single container.

- **Backups** — watch selected files and auto-upload `tar.gz` archives to a
  Nextcloud target (WebDAV) on change.
- **Single password gate** — one-time setup, BIP39 passphrase, CLI-only reset.
- **One container** — Node + Nuxt, SQLite, configured via env vars only.

## Setup

See **[docs/setup.md](docs/setup.md)** to deploy on a VPS with Docker Compose.

## Development

```bash
npm install
npm run dev        # http://localhost:<auto-port>
```

Checks: `npm run lint` · `npm run typecheck` · `npm run test:unit` · `npm run test:e2e`
