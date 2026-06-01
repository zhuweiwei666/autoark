import { buildFacebookAssetDiagnostics } from '../src/services/facebookAssets.diagnostics.service'

describe('facebook asset diagnostics', () => {
  it('marks authorization as blocked when no active token exists', () => {
    const diagnostics = buildFacebookAssetDiagnostics({ tokens: [], users: [] })

    expect(diagnostics.authorized).toBe(false)
    expect(diagnostics.summary.readyAccountCount).toBe(0)
    expect(diagnostics.checklist.find(item => item.id === 'authorization')?.status).toBe('blocked')
    expect(diagnostics.risks[0].level).toBe('critical')
  })

  it('counts ready accounts that have active status, page, and pixel', () => {
    const diagnostics = buildFacebookAssetDiagnostics({
      tokens: [{ _id: 'token_1', fbUserId: 'fb_1' }],
      users: [{
        fbUserId: 'fb_1',
        syncStatus: 'completed',
        lastSyncedAt: '2026-06-01T12:00:00.000Z',
        adAccounts: [
          { accountId: 'act_1', name: 'Ready account', status: 1 },
          { accountId: 'act_2', name: 'No pixel account', status: 1 },
          { accountId: 'act_3', name: 'Disabled account', status: 2 },
        ],
        pages: [
          { pageId: 'page_1', name: 'Page 1', accounts: [{ accountId: 'act_1' }] },
          { pageId: 'page_2', name: 'Page 2', accounts: [{ accountId: 'act_2' }] },
          { pageId: 'page_3', name: 'Page 3', accounts: [{ accountId: 'act_3' }] },
        ],
        pixels: [
          { pixelId: 'pixel_1', name: 'Pixel 1', accounts: [{ accountId: 'act_1' }] },
          { pixelId: 'pixel_3', name: 'Pixel 3', accounts: [{ accountId: 'act_3' }] },
        ],
      }],
    })

    expect(diagnostics.authorized).toBe(true)
    expect(diagnostics.summary.accountCount).toBe(3)
    expect(diagnostics.summary.readyAccountCount).toBe(1)
    expect(diagnostics.summary.pageLinkedAccountCount).toBe(3)
    expect(diagnostics.summary.pixelLinkedAccountCount).toBe(2)
    expect(diagnostics.accounts.find(account => account.accountId === 'act_1')?.ready).toBe(true)
    expect(diagnostics.accounts.find(account => account.accountId === 'act_2')?.issues).toContain('没有可用 Pixel')
    expect(diagnostics.accounts.find(account => account.accountId === 'act_2')?.issueDetails[0]).toMatchObject({
      code: 'MISSING_PIXEL',
      severity: 'blocked',
    })
    expect(diagnostics.accounts.find(account => account.accountId === 'act_3')?.issues[0]).toContain('已停用')
    expect(diagnostics.accounts.find(account => account.accountId === 'act_3')?.issueDetails.map(issue => issue.code)).toContain('ACCOUNT_NOT_ACTIVE')
  })
})
