import fs from 'fs'
import path from 'path'
import { runExternalMaterialCronTick } from '../src/cron/externalMaterial.cron'

const repoRoot = path.resolve(__dirname, '../..')

const readRepoFile = (relativePath: string): string =>
  fs.readFileSync(path.join(repoRoot, relativePath), 'utf8')

const parseEnvFile = (source: string): Record<string, string> =>
  Object.fromEntries(
    source
      .split(/\r?\n/)
      .filter((line) => line && !line.startsWith('#'))
      .map((line) => {
        const separator = line.indexOf('=')
        return [line.slice(0, separator), line.slice(separator + 1)]
      }),
  )

describe('external material production configuration', () => {
  it('documents a disabled default with no provider-key fallback', async () => {
    const env = parseEnvFile(readRepoFile('deploy/env.example'))

    expect(env.EXTERNAL_MATERIAL_SYNC_ENABLED).toBe('false')
    expect(env.GUANGDADA_API_KEY).toBe('')

    const dependencies = {
      env,
      states: { get: jest.fn() },
      enqueue: jest.fn(),
      reconcile: jest.fn(),
      recoverExpiredClaims: jest.fn(),
    }

    await runExternalMaterialCronTick(dependencies as any)

    expect(dependencies.states.get).not.toHaveBeenCalled()
    expect(dependencies.enqueue).not.toHaveBeenCalled()
  })

  it('does not start external work when enabled without a non-empty key', async () => {
    const dependencies = {
      env: {
        EXTERNAL_MATERIAL_SYNC_ENABLED: 'true',
        GUANGDADA_API_KEY: '   ',
      },
      states: { get: jest.fn() },
      enqueue: jest.fn(),
      reconcile: jest.fn(),
      recoverExpiredClaims: jest.fn(),
    }

    await runExternalMaterialCronTick(dependencies as any)

    expect(dependencies.states.get).not.toHaveBeenCalled()
    expect(dependencies.enqueue).not.toHaveBeenCalled()
  })

  it('scopes the provider key and strict feature flag to the deploy action step', () => {
    const workflow = readRepoFile('.github/workflows/prod-deploy.yml')
    const deployStepStart = workflow.indexOf(
      '      - name: Deploy to production',
    )

    expect(deployStepStart).toBeGreaterThan(-1)
    const beforeDeployStep = workflow.slice(0, deployStepStart)
    const deployStep = workflow.slice(deployStepStart)

    expect(beforeDeployStep).not.toContain('GUANGDADA_API_KEY')
    expect(beforeDeployStep).not.toContain('EXTERNAL_MATERIAL_SYNC_ENABLED')
    expect(deployStep).toContain(
      'GUANGDADA_API_KEY: ${{ secrets.GUANGDADA_API_KEY }}',
    )
    expect(deployStep).toContain(
      "EXTERNAL_MATERIAL_SYNC_ENABLED: ${{ vars.EXTERNAL_MATERIAL_SYNC_ENABLED || 'false' }}",
    )
  })
})
