import {
  buildFacebookBulkCreateErrorPayload,
  createAdCreative,
} from '../src/integration/facebook/bulkCreate.api'
import { facebookClient } from '../src/integration/facebook/facebookClient'

describe('facebook bulk create error payload', () => {
  afterEach(() => {
    jest.restoreAllMocks()
  })

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

  it('serializes Meta video auto-crop enrollment in the creative request', async () => {
    const post = jest.spyOn(facebookClient, 'post').mockResolvedValue({ id: 'creative_1' } as any)
    const degreesOfFreedomSpec = {
      creative_features_spec: {
        video_auto_crop: {
          enroll_status: 'OPT_IN',
        },
      },
    }

    await createAdCreative({
      accountId: '123',
      token: 'secret-token',
      name: 'Auto crop creative',
      objectStorySpec: {
        page_id: 'page_1',
        video_data: { video_id: 'video_1' },
      },
      degreesOfFreedomSpec,
    })

    expect(post).toHaveBeenCalledWith('/act_123/adcreatives', expect.objectContaining({
      degrees_of_freedom_spec: JSON.stringify(degreesOfFreedomSpec),
    }))
  })
})
