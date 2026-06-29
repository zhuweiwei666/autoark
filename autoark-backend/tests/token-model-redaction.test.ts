import FbToken from '../src/models/FbToken'
import TiktokToken from '../src/models/TiktokToken'

describe('token model redaction', () => {
  it('redacts Facebook token values during serialization', () => {
    const token = new FbToken({
      userId: '665000000000000000000002',
      token: 'EAA_REAL_FACEBOOK_TOKEN',
      status: 'active',
    })

    expect(token.toJSON()).not.toHaveProperty('token')
    expect(token.toObject()).not.toHaveProperty('token')
  })

  it('redacts TikTok access and refresh tokens during serialization', () => {
    const token = new TiktokToken({
      userId: '665000000000000000000002',
      accessToken: 'tt_access_token',
      refreshToken: 'tt_refresh_token',
      advertiserIds: ['adv_1'],
      status: 'active',
    })

    expect(token.toJSON()).not.toHaveProperty('accessToken')
    expect(token.toJSON()).not.toHaveProperty('refreshToken')
    expect(token.toObject()).not.toHaveProperty('accessToken')
    expect(token.toObject()).not.toHaveProperty('refreshToken')
  })
})
