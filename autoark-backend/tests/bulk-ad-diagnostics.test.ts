import { diagnoseBulkAdError, normalizeTaskErrors } from '../src/services/bulkAd.diagnostics'

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
})
