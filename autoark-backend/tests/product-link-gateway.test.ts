import { readFileSync } from 'fs'
import path from 'path'

const repoRoot = path.resolve(__dirname, '../..')

describe('product short-link gateway', () => {
  it('proxies public /r links to the backend instead of the frontend SPA', () => {
    const nginx = readFileSync(
      path.join(repoRoot, 'deploy/nginx/autoark.conf'),
      'utf8',
    )

    expect(nginx).toMatch(
      /location \/r\/ \{[\s\S]*proxy_pass \$backend_upstream;/,
    )
  })

  it('mounts the public redirect route before the frontend fallback', () => {
    const app = readFileSync(
      path.join(repoRoot, 'autoark-backend/src/app.ts'),
      'utf8',
    )
    const redirectRoute = app.indexOf(
      "app.use('/r', productLinkRedirectRoutes)",
    )
    const frontendFallback = app.indexOf('Serve frontend static files')

    expect(redirectRoute).toBeGreaterThan(-1)
    expect(frontendFallback).toBeGreaterThan(redirectRoute)
  })
})
