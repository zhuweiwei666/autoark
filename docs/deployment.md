# AutoArk Production Deployment

This is the canonical deployment document. Production no longer uses PM2 or a
host-level Nginx app process. It runs through Docker Compose under
`/opt/autoark`.

## Production Targets

- App: `https://app.autoark.work`
- API: `https://api.autoark.work`
- Agent: `https://app.autoark.work/agent/`
- Server app dir: `/opt/autoark`
- Server env file: `/opt/autoark/deploy/.env`
- Local env backup: `/Users/zww/.config/autoark/prod.env`

Do not print secrets from either env file.

## Release Policy

Use `main` for normal production releases.

Recommended path:

1. Make changes on a feature branch.
2. Run local build checks.
3. Merge to `main`.
4. Deploy `main` with the deploy wrapper.
5. Run production verification.

Emergency rollback path:

```bash
AUTOARK_REF=<known-good-commit> bash deploy/prod-deploy.sh
```

## Local Preflight

Before deploying code changes:

```bash
cd /Users/zww/autoark
git status --short
cd autoark-frontend && npm run build
cd ../autoark-backend && npm run build
cd ../autoark-agent && npm run build
cd web && npm run build
```

The CI workflow runs the same package builds and Docker production smoke builds.

## Deploy From Local Machine

From a clean checkout:

```bash
cd /Users/zww/autoark
AUTOARK_REF=main bash deploy/prod-deploy.sh
```

Useful environment variables:

- `PROD_HOST=root@45.33.103.31`
- `APP_DIR=/opt/autoark`
- `AUTOARK_REF=main`
- `AUTOARK_ENV_FILE=/Users/zww/.config/autoark/prod.env`
- `AUTOARK_SKIP_VERIFY=true`

If `AUTOARK_ENV_FILE` is provided, the wrapper uploads it to `/root/prod.env`
and keeps permissions at `600`. The server deploy script then copies it into
`deploy/.env` only when the server env file is missing.

## Deploy On The Server

```bash
ssh root@45.33.103.31
cd /opt/autoark
AUTOARK_REF=main bash deploy/server-deploy.sh
```

`deploy/server-deploy.sh` is idempotent and safe to re-run. It:

- locks deployment so two deploys do not run at once
- fetches the requested Git ref
- validates `deploy/.env` exists and restricts permissions
- validates Docker Compose config
- builds and starts `gateway`, `backend`, `agent`, and `redis`
- obtains or renews the TLS certificate through Certbot
- installs a systemd timer for certificate renewal
- ensures the configured super admin exists
- verifies local gateway `/healthz`
- records the deployed ref and commit in `/opt/autoark/deploy/.last-deploy`

## Verify Production

```bash
bash deploy/verify-production.sh
```

Checks performed:

- `GET https://app.autoark.work/`
- `GET https://app.autoark.work/login`
- `GET https://app.autoark.work/dashboard`
- `GET https://app.autoark.work/agent/`
- `GET https://app.autoark.work/agent/login`
- `GET https://api.autoark.work/healthz`
- admin login for main system and Agent when
  `~/.config/autoark/admin-credentials.txt` exists

The verification script only prints status and token presence. It does not print
passwords.

## Inspect Production

Container status:

```bash
ssh root@45.33.103.31 'cd /opt/autoark && docker compose -f deploy/docker-compose.prod.yml ps'
```

Recent logs:

```bash
ssh root@45.33.103.31 'cd /opt/autoark && docker compose -f deploy/docker-compose.prod.yml logs --tail=100 gateway backend agent'
```

Last deployed commit:

```bash
ssh root@45.33.103.31 'cat /opt/autoark/deploy/.last-deploy'
```

## TLS

The gateway serves HTTPS directly from the Docker deployment. Certificates live
under `/opt/autoark/deploy/tls/live`, backed by Certbot data in
`/opt/autoark/deploy/certbot/conf`.

Manual renewal:

```bash
ssh root@45.33.103.31 'cd /opt/autoark && bash deploy/server-renew-cert.sh'
```

Automatic renewal is installed as:

- `autoark-cert-renew.service`
- `autoark-cert-renew.timer`

## Environment File Rules

- Never commit real env files.
- Server truth is `/opt/autoark/deploy/.env`.
- Local backup may exist at `/Users/zww/.config/autoark/prod.env`.
- Keep permissions at `600`.
- Update `deploy/env.example` whenever a new required env var is introduced.

## Legacy Notes

Old PM2 deployment docs and scripts remain in the repository as historical
references only. For production, use only:

- `deploy/prod-deploy.sh`
- `deploy/server-deploy.sh`
- `deploy/verify-production.sh`
- `deploy/docker-compose.prod.yml`
- `deploy/nginx/autoark.conf`
