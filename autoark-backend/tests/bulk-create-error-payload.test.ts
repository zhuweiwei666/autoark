import { buildFacebookBulkCreateErrorPayload } from '../src/integration/facebook/bulkCreate.api'

describe('facebook bulk create error payload', () => {
  it('preserves FacebookApiError style response.error fields', () => {
    const error: any = new Error('Facebook API failed')
    error.code = 100
    error.subcode = 1885316
    error.userMessage = '所选 Pixel 无法访问'
    error.response = {
      error: {
        code: 100,
        error_subcode: 1885316,
        message: 'Object with ID pixel_id cannot be loaded due to missing permissions',
        error_user_msg: '所选 Pixel 无法访问',
        type: 'OAuthException',
      },
    }

    const payload = buildFacebookBulkCreateErrorPayload(error)

    expect(payload).toMatchObject({
      code: 100,
      subcode: 1885316,
      message: 'Object with ID pixel_id cannot be loaded due to missing permissions',
      userMsg: '所选 Pixel 无法访问',
      type: 'OAuthException',
    })
  })

  it('preserves Axios response.data.error fields and redacts tokens in details', () => {
    const error: any = new Error('Request failed')
    error.response = {
      data: {
        error: {
          code: 190,
          error_subcode: 463,
          message: 'Error validating access token',
          error_user_title: '授权已失效',
        },
        access_token: 'EAA-secret-token',
      },
    }

    const payload = buildFacebookBulkCreateErrorPayload(error)

    expect(payload).toMatchObject({
      code: 190,
      subcode: 463,
      message: 'Error validating access token',
      userTitle: '授权已失效',
    })
    expect(payload.details.access_token).toBe('[REDACTED]')
  })
})
