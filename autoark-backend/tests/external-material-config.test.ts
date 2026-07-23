import fs from 'fs'
import os from 'os'
import path from 'path'
import { execFileSync } from 'child_process'
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

const extractWorkflowRunScript = (
  workflow: string,
  stepName: string,
): string => {
  const stepStart = workflow.indexOf(`      - name: ${stepName}`)
  if (stepStart < 0) throw new Error(`Workflow step not found: ${stepName}`)
  const nextStep = workflow.indexOf('\n      - ', stepStart + 1)
  const step = workflow.slice(
    stepStart,
    nextStep < 0 ? workflow.length : nextStep,
  )
  const runStart = step.indexOf('        run: |\n')
  if (runStart < 0) throw new Error(`Workflow run block not found: ${stepName}`)
  return step
    .slice(runStart + '        run: |\n'.length)
    .split('\n')
    .filter((line) => line.startsWith('          '))
    .map((line) => line.slice(10))
    .join('\n')
}

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

  it('gates all production secrets behind merged-ref validation and deploys only its immutable SHA', () => {
    const workflow = readRepoFile('.github/workflows/prod-deploy.yml')
    const deployScript = readRepoFile('deploy/prod-deploy.sh')
    const validationStart = workflow.indexOf(
      '      - name: Validate merged deployment ref',
    )
    const sshSecretStart = workflow.indexOf(
      '      - name: Install production SSH identity',
    )
    const providerSecretStart = workflow.indexOf(
      '      - name: Deploy to production',
    )

    expect(workflow).toContain('    environment: production')
    expect(workflow).toContain('persist-credentials: false')
    expect(validationStart).toBeGreaterThan(-1)
    expect(validationStart).toBeLessThan(sshSecretStart)
    expect(sshSecretStart).toBeLessThan(providerSecretStart)

    const validationStep = workflow.slice(validationStart, sshSecretStart)
    expect(validationStep).toContain('git fetch --no-tags origin main')
    expect(validationStep).toContain(
      'git merge-base --is-ancestor "$DEPLOY_SHA" origin/main',
    )
    expect(validationStep).toContain(
      `printf 'sha=%s\\n' "$DEPLOY_SHA" >> "$GITHUB_OUTPUT"`,
    )
    expect(validationStep).not.toMatch(/secrets\.|AUTOARK_PROD_|GUANGDADA/)

    const deployStep = workflow.slice(providerSecretStart)
    expect(deployStep).toContain(
      'AUTOARK_REF: ${{ steps.validate-ref.outputs.sha }}',
    )
    expect(deployStep).not.toContain('AUTOARK_REF: ${{ inputs.ref }}')
    expect(deployScript).toContain(
      'AUTOARK_REF must be a verified 40-character commit SHA',
    )
    expect(deployScript).toMatch(/\^\[0-9a-f\]\{40\}\$/)
  })

  it('rejects an unmerged workflow ref before any secret-bearing step can run', () => {
    const workflow = readRepoFile('.github/workflows/prod-deploy.yml')
    const validationScript = extractWorkflowRunScript(
      workflow,
      'Validate merged deployment ref',
    )
    const tempRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), 'autoark-ref-validation-'),
    )
    const remote = path.join(tempRoot, 'origin.git')
    const checkout = path.join(tempRoot, 'checkout')
    const output = path.join(tempRoot, 'github-output')
    const runGit = (args: string[]) =>
      execFileSync('git', args, { cwd: checkout, stdio: 'pipe' })

    try {
      execFileSync('git', ['init', '--bare', remote], { stdio: 'pipe' })
      execFileSync('git', ['init', '-b', 'main', checkout], { stdio: 'pipe' })
      runGit(['config', 'user.email', 'test@example.com'])
      runGit(['config', 'user.name', 'Test'])
      fs.writeFileSync(path.join(checkout, 'tracked.txt'), 'merged\n')
      runGit(['add', 'tracked.txt'])
      runGit(['commit', '-m', 'merged'])
      runGit(['remote', 'add', 'origin', remote])
      runGit(['push', '-u', 'origin', 'main'])
      runGit(['switch', '-c', 'malicious-ref'])
      fs.writeFileSync(path.join(checkout, 'unmerged.txt'), 'unmerged\n')
      runGit(['add', 'unmerged.txt'])
      runGit(['commit', '-m', 'unmerged'])

      expect(() =>
        execFileSync('bash', ['-euo', 'pipefail', '-c', validationScript], {
          cwd: checkout,
          env: { ...process.env, GITHUB_OUTPUT: output },
          stdio: 'pipe',
        }),
      ).toThrow()
      expect(fs.existsSync(output) ? fs.readFileSync(output, 'utf8') : '').toBe(
        '',
      )
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true })
    }
  })

  it('pins the production host key and forbids trust-on-first-use', () => {
    const workflow = readRepoFile('.github/workflows/prod-deploy.yml')

    expect(workflow).toContain(
      'AUTOARK_PROD_HOST_KEY: ${{ secrets.AUTOARK_PROD_HOST_KEY }}',
    )
    expect(workflow).toContain('test -n "$AUTOARK_PROD_HOST_KEY"')
    expect(workflow).toContain('HostKeyAlias autoark-prod-production')
    expect(workflow).toContain('UserKnownHostsFile ~/.ssh/known_hosts')
    expect(workflow).toContain('StrictHostKeyChecking yes')
    expect(workflow).not.toMatch(/accept-new|ssh-keyscan/)

    const installScript = extractWorkflowRunScript(
      workflow,
      'Install production SSH identity',
    )
    const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'autoark-ssh-pin-'))
    try {
      expect(() =>
        execFileSync('bash', ['-euo', 'pipefail', '-c', installScript], {
          env: {
            ...process.env,
            HOME: tempHome,
            AUTOARK_PROD_SSH_KEY: 'unit-test-private-key-placeholder',
            AUTOARK_PROD_HOST_KEY: '',
          },
          stdio: 'pipe',
        }),
      ).toThrow()
      expect(fs.existsSync(path.join(tempHome, '.ssh/config'))).toBe(false)
    } finally {
      fs.rmSync(tempHome, { recursive: true, force: true })
    }
  })

  it('holds the canonical deployment lock across checkout, pair commit, and server deployment without self-deadlock', () => {
    const deployScript = readRepoFile('deploy/prod-deploy.sh')
    const lockIndex = deployScript.indexOf('flock -x 8')
    const checkoutIndex = deployScript.indexOf(
      'git fetch --no-tags origin main',
      lockIndex,
    )
    const rootCommitIndex = deployScript.indexOf(
      'mv -f -- "$root_stage_path" "$backup_env_path"',
      checkoutIndex,
    )
    const serverDeployIndex = deployScript.indexOf(
      'bash deploy/server-deploy.sh',
      rootCommitIndex,
    )

    expect(lockIndex).toBeGreaterThan(-1)
    expect(lockIndex).toBeLessThan(checkoutIndex)
    expect(checkoutIndex).toBeLessThan(rootCommitIndex)
    expect(rootCommitIndex).toBeLessThan(serverDeployIndex)
    expect(deployScript).toContain(
      'inner_lock_file="${transaction_prefix}.server-deploy.lock"',
    )
    expect(deployScript).toContain(
      'AUTOARK_DEPLOY_LOCK_FILE="$inner_lock_file"',
    )
  })
})
