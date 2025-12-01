# Deployment Guide

AutoArk supports automated deployment via GitHub Webhooks and shell scripts.

## Webhook Deployment

- **Endpoint**: `POST /webhook` (Port 3001)
- **Security**: Verifies `x-hub-signature-256` using a secret key.
- **Action**: Triggers `auto-deploy.sh` script.

## Manual Deployment

1.  SSH into the server.
2.  Navigate to the project directory.
3.  Run `git pull`.
4.  Run `npm install` and `npm run build`.
5.  Restart services using PM2: `pm2 restart all`.

## Environment Variables

Ensure `.env` is configured with:
- `MONGO_URI`
- `FB_ACCESS_TOKEN`
- `PORT`
- `CRON_SYNC_INTERVAL`

