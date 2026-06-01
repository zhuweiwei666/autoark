export function getBuildInfo() {
  const commit = process.env.AUTOARK_DEPLOY_COMMIT || process.env.GIT_COMMIT || ''

  return {
    service: 'autoark-backend',
    environment: process.env.NODE_ENV || 'development',
    ref: process.env.AUTOARK_DEPLOY_REF || 'local',
    commit: commit || 'unknown',
    shortCommit: commit ? commit.slice(0, 12) : 'unknown',
    deployedAt: process.env.AUTOARK_DEPLOYED_AT || null,
    uptime: process.uptime(),
  }
}
