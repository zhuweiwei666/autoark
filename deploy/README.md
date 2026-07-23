# AutoArk Deploy Runbook

This directory is the canonical production deploy entrypoint for AutoArk.

Production runs with Docker Compose on the server:

- `gateway`: Nginx, public ports 80 and 443
- `backend`: main AutoArk API, container port 3001
- `agent`: AutoArk Agent API and web app, container port 3002
- `redis`: queue/cache

The production server stores secrets in `/opt/autoark/deploy/.env`. Do not commit
real secrets and do not print them in chat or logs.

External material ingestion uses two production-only entries:

```dotenv
GUANGDADA_API_KEY=
EXTERNAL_MATERIAL_SYNC_ENABLED=false
```

Keep the feature flag at `false` until a rotated provider key has been installed.
The deploy wrapper accepts only `true` or `false`, refuses to enable sync with an
empty key, and streams both values over SSH standard input. It atomically updates
only these named entries in `/root/prod.env` and
`/opt/autoark/deploy/.env`, preserving the rest of each file and enforcing mode
`600`. The values are never placed in SSH arguments or deploy logs. When an
override is not set, the value already present in the selected environment source
is preserved.

## Standard Release Flow

1. Merge or push the release ref to GitHub.
2. From a clean local checkout, run:

```bash
git fetch origin main
AUTOARK_REF="$(git rev-parse 'origin/main^{commit}')" bash deploy/prod-deploy.sh
```

3. The local deploy wrapper connects to the server, runs
   `deploy/server-deploy.sh`, then runs `deploy/verify-production.sh`.

Useful overrides:

```bash
PROD_HOST=root@45.33.103.31 AUTOARK_REF=<verified-40-character-sha> bash deploy/prod-deploy.sh
AUTOARK_REF=<verified-40-character-sha> AUTOARK_ENV_FILE=/Users/zww/.config/autoark/prod.env bash deploy/prod-deploy.sh
AUTOARK_REF=<verified-40-character-sha> AUTOARK_SKIP_VERIFY=true bash deploy/prod-deploy.sh
```

GitHub Actions supplies `GUANGDADA_API_KEY` from the repository secret of the
same name and `EXTERNAL_MATERIAL_SYNC_ENABLED` from the repository variable of
the same name only to the deploy step. The production job is protected by the
GitHub `production` environment. Before any production secret is exposed, the
workflow proves the requested commit is already contained in `origin/main` and
passes only its immutable SHA to the deploy wrapper.

Configure `AUTOARK_PROD_HOST_KEY` as the trusted, single-line SSH host public key
for the production server, for example an `ssh-ed25519 ...` line obtained through
an authenticated out-of-band channel. The workflow pins it to the fixed
`autoark-prod-production` alias and refuses to use trust-on-first-use or
runtime host-key discovery.

`AUTOARK_ENV_FILE` remains supported for full environment-file rotation. It is
uploaded to a non-canonical pending path first. One server-side deployment lock
then covers checkout, construction of the complete two-file environment pair,
secret synchronization, pair commit, and `server-deploy.sh`. The old pair and a
recovery marker remain until deployment succeeds. An interrupted or failed
deployment rolls back, and a normal retry consumes a completed pending upload
and converges `/root/prod.env` with runtime `deploy/.env`.

## First Server Bootstrap

Run once on a new Ubuntu server:

```bash
ssh root@45.33.103.31
bash <(curl -fsSL https://raw.githubusercontent.com/zhuweiwei666/autoark/main/deploy/server-bootstrap.sh)
```

Then put the production env file on the server:

```bash
mkdir -p /opt/autoark/deploy
cp /root/prod.env /opt/autoark/deploy/.env
chmod 600 /opt/autoark/deploy/.env
```

Finally deploy:

```bash
cd /opt/autoark
AUTOARK_REF=main bash deploy/server-deploy.sh
```

## Server-Side Deploy

`deploy/server-deploy.sh` is idempotent. It:

- clones or updates `/opt/autoark`
- checks out `AUTOARK_REF` from GitHub
- validates Docker Compose config
- builds and starts all production containers
- issues or renews the Let's Encrypt certificate when enabled
- installs the certificate renewal systemd timer
- ensures the configured super admin exists
- verifies the local gateway `/healthz`
- writes `deploy/.last-deploy`

Manual server command:

```bash
ssh root@45.33.103.31
cd /opt/autoark
AUTOARK_REF=main bash deploy/server-deploy.sh
```

## Verification

Run from local machine:

```bash
bash deploy/verify-production.sh
```

It checks:

- `https://app.autoark.work/`
- `https://app.autoark.work/login`
- `https://app.autoark.work/dashboard`
- `https://app.autoark.work/agent/`
- `https://app.autoark.work/agent/login`
- `https://api.autoark.work/healthz`
- optional main and Agent admin login when local credentials exist at
  `~/.config/autoark/admin-credentials.txt`

## Rollback

Deploy a known good commit or tag:

```bash
AUTOARK_REF=<commit-or-tag> bash deploy/prod-deploy.sh
```

The server records the last deployed ref and commit in:

```bash
/opt/autoark/deploy/.last-deploy
```

## Operations

Container status:

```bash
ssh root@45.33.103.31 'cd /opt/autoark && docker compose -f deploy/docker-compose.prod.yml ps'
```

Logs:

```bash
ssh root@45.33.103.31 'cd /opt/autoark && docker compose -f deploy/docker-compose.prod.yml logs --tail=100 gateway backend agent'
```

Renew TLS manually:

```bash
ssh root@45.33.103.31 'cd /opt/autoark && bash deploy/server-renew-cert.sh'
```

Old PM2 deployment documents and scripts have been removed from the repository.
Use this Docker Compose flow for production.
