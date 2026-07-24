import {
  buildTaskOperationalDiagnostics,
  diagnoseBulkAdError,
  normalizeTaskErrors,
} from '../src/services/bulkAd.diagnostics'

describe('bulk ad diagnostics', () => {
  it('classifies missing Facebook authorization as a non-retryable customer action', () => {
    const diagnosis = diagnoseBulkAdError(new Error('没有找到可访问账户 123 的 Facebook Token，请检查授权'))

    expect(diagnosis.errorCode).toBe('FACEBOOK_AUTH_REQUIRED')
    expect(diagnosis.retryable).toBe(false)
    expect(diagnosis.customerMessage).toContain('Facebook 授权')
    expect(diagnosis.nextActions.join(' ')).toContain('重新使用 Facebook Login for Business 授权')
  })

  it('classifies Meta rate limits as retryable', () => {
    const diagnosis = diagnoseBulkAdError({
      response: {
        error: {
          code: 4,
          message: 'Application request limit reached',
        },
      },
    })

    expect(diagnosis.errorCode).toBe('META_RATE_LIMIT')
    expect(diagnosis.retryable).toBe(true)
    expect(diagnosis.rawCode).toBe(4)
  })

  it('classifies pixel access failures with concrete next steps', () => {
    const diagnosis = diagnoseBulkAdError({
      code: 100,
      message: 'Object with ID pixel_id does not exist, cannot be loaded due to missing permissions',
    })

    expect(diagnosis.errorCode).toBe('PIXEL_ACCESS_REQUIRED')
    expect(diagnosis.entityType).toBe('pixel')
    expect(diagnosis.nextActions.join(' ')).toContain('Pixel 分配给该广告账户')
  })

  it('classifies Instagram asset access failures separately from creative failures', () => {
    const diagnosis = diagnoseBulkAdError({
      code: 100,
      message: 'Invalid instagram_actor_id: Instagram account is not connected to the selected Facebook Page',
    })

    expect(diagnosis.errorCode).toBe('INSTAGRAM_ACCESS_REQUIRED')
    expect(diagnosis.entityType).toBe('instagram')
    expect(diagnosis.nextActions.join(' ')).toContain('Instagram 账号是否已绑定')
  })

  it('classifies catalog and product set access failures with catalog next steps', () => {
    const diagnosis = diagnoseBulkAdError({
      response: {
        data: {
          error: {
            code: 100,
            message: 'Product set is unavailable or the ad account has no permission to use this catalog',
          },
        },
      },
    })

    expect(diagnosis.errorCode).toBe('CATALOG_ACCESS_REQUIRED')
    expect(diagnosis.entityType).toBe('catalog')
    expect(diagnosis.nextActions.join(' ')).toContain('Catalog/Product Set 分配')
  })

  it('classifies destination URL failures before generic Meta validation', () => {
    const diagnosis = diagnoseBulkAdError({
      code: 100,
      message: 'Invalid destination_url: landing page URL is malformed or blocked by domain validation',
    })

    expect(diagnosis.errorCode).toBe('DESTINATION_URL_INVALID')
    expect(diagnosis.entityType).toBe('destination')
    expect(diagnosis.nextActions.join(' ')).toContain('websiteUrl')
  })

  it('does not misclassify generic object_story_spec validation as Page access', () => {
    const diagnosis = diagnoseBulkAdError({
      code: 100,
      subcode: 1443050,
      message: 'Invalid parameter',
      userMsg: 'object_story_spec的 video_data 字段不支持 caption 字段。',
    })

    expect(diagnosis.errorCode).toBe('META_VALIDATION_ERROR')
    expect(diagnosis.errorCode).not.toBe('PAGE_ACCESS_REQUIRED')
  })

  it('classifies ad policy review failures as non-retryable content actions', () => {
    const diagnosis = diagnoseBulkAdError({
      code: 100,
      message: 'Ad was rejected because it violates Meta Advertising Policies and requires review',
    })

    expect(diagnosis.errorCode).toBe('AD_POLICY_REVIEW')
    expect(diagnosis.entityType).toBe('policy')
    expect(diagnosis.retryable).toBe(false)
    expect(diagnosis.nextActions.join(' ')).toContain('政策')
  })

  it('classifies billing and spend-cap blockers as account unavailable', () => {
    const diagnosis = diagnoseBulkAdError({
      message: 'Cannot create ad because this ad account has an outstanding balance and account spend limit',
    })

    expect(diagnosis.errorCode).toBe('AD_ACCOUNT_UNAVAILABLE')
    expect(diagnosis.entityType).toBe('account')
    expect(diagnosis.nextActions.join(' ')).toContain('账单')
  })

  it('preserves explicit no-ad-created errors and enriches them', () => {
    const diagnosis = diagnoseBulkAdError({
      entityType: 'ad',
      errorCode: 'NO_ADS_CREATED',
      errorMessage: '素材创建失败，未能创建任何广告',
    })

    expect(diagnosis.errorCode).toBe('NO_ADS_CREATED')
    expect(diagnosis.source).toBe('autoark')
    expect(diagnosis.customerMessage).toContain('没有成功创建任何广告')
  })

  it('normalizes legacy string task errors', () => {
    const errors = normalizeTaskErrors('Task execution timed out or worker crashed')

    expect(errors).toHaveLength(1)
    expect(errors[0].errorCode).toBe('WORKER_TIMEOUT')
    expect(errors[0].customerMessage).toContain('超时')
  })

  it('aggregates task-level operational diagnostics by error code and actionability', () => {
    const diagnostics = buildTaskOperationalDiagnostics({
      _id: 'task_1',
      status: 'failed',
      items: [
        {
          accountId: 'act_1',
          accountName: 'Account 1',
          status: 'failed',
          errors: [{
            code: 100,
            message: 'Selected pixel_id cannot be loaded due to missing permissions',
          }],
        },
        {
          accountId: 'act_2',
          accountName: 'Account 2',
          status: 'failed',
          errors: ['Application request limit reached'],
        },
        {
          accountId: 'act_3',
          accountName: 'Account 3',
          status: 'success',
          errors: [],
        },
      ],
    })

    expect(diagnostics.health).toBe('mixed')
    expect(diagnostics.summary.totalAccounts).toBe(3)
    expect(diagnostics.summary.failedAccounts).toBe(2)
    expect(diagnostics.summary.retryableErrors).toBe(1)
    expect(diagnostics.summary.blockedErrors).toBe(1)
    expect(diagnostics.buckets.map(bucket => bucket.errorCode)).toEqual([
      'PIXEL_ACCESS_REQUIRED',
      'META_RATE_LIMIT',
    ])
    expect(diagnostics.buckets[0].accounts[0]).toMatchObject({
      accountId: 'act_1',
      accountName: 'Account 1',
    })
    expect(diagnostics.topNextActions.join(' ')).toContain('Pixel 分配给该广告账户')
  })
})
