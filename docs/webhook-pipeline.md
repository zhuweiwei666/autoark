# Webhook Pipeline

The webhook service facilitates continuous integration and deployment.

## Components

- **Source**: `autoark-backend/src/webhook.js` (Pure Node.js implementation).
- **Process**: PM2 managed process `autoark-webhook`.
- **Port**: 3001.

## Flow

1.  GitHub push event triggers webhook.
2.  Webhook server receives POST request.
3.  Server validates HMAC signature.
4.  If valid, executes `/root/auto-deploy.sh`.
5.  Script pulls code, builds, and restarts the main application.

