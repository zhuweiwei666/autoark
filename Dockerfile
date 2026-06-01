# syntax=docker/dockerfile:1.7

FROM node:20-bookworm-slim AS backend-build
WORKDIR /build/autoark-backend
COPY autoark-backend/package*.json ./
RUN npm ci
COPY autoark-backend/ ./
RUN npm run build

FROM node:20-bookworm-slim AS frontend-build
WORKDIR /build/autoark-frontend
COPY autoark-frontend/package*.json ./
RUN npm ci
COPY autoark-frontend/ ./
RUN npm run build

FROM node:20-bookworm-slim AS agent-build
WORKDIR /build/autoark-agent
COPY autoark-agent/package*.json ./
RUN npm ci
COPY autoark-agent/ ./
RUN npm run build
WORKDIR /build/autoark-agent/web
RUN npm ci && npm run build

FROM node:20-bookworm-slim AS backend-runtime
ENV NODE_ENV=production \
    PORT=3001
WORKDIR /app/autoark-backend
COPY autoark-backend/package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=backend-build /build/autoark-backend/dist ./dist
COPY --from=frontend-build /build/autoark-frontend/dist /app/autoark-frontend/dist
COPY deploy/runtime/ensure-super-admin.js ./ensure-super-admin.js
RUN mkdir -p logs
EXPOSE 3001
CMD ["node", "dist/server.js"]

FROM node:20-bookworm-slim AS agent-runtime
ENV NODE_ENV=production \
    PORT=3002
WORKDIR /app/autoark-agent
COPY autoark-agent/package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=agent-build /build/autoark-agent/dist ./dist
COPY --from=agent-build /build/autoark-agent/web/dist ./web/dist
EXPOSE 3002
CMD ["node", "dist/server.js"]

FROM nginx:1.27-alpine AS gateway
COPY deploy/nginx/autoark.conf /etc/nginx/conf.d/default.conf
COPY --from=frontend-build /build/autoark-frontend/dist /usr/share/nginx/html/
COPY --from=agent-build /build/autoark-agent/web/dist /usr/share/nginx/html/agent/
EXPOSE 80
