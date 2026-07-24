import FacebookUser from '../src/models/FacebookUser'
import { getCachedPages } from '../src/services/facebookUser.service'

describe('facebook user asset security', () => {
  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('removes page access tokens from serialized facebook user cache documents', () => {
    const user = new FacebookUser({
      fbUserId: 'fb_123',
      pages: [{
        pageId: 'page_1',
        name: 'Page 1',
        accessToken: 'PAGE_ACCESS_TOKEN',
        accounts: [{ accountId: 'act_1' }],
      }],
    })

    const serialized = user.toJSON()
    expect(serialized.pages[0]).toMatchObject({
      pageId: 'page_1',
      name: 'Page 1',
    })
    expect(serialized.pages[0]).not.toHaveProperty('accessToken')
    expect(serialized.pages[0]).not.toHaveProperty('access_token')
  })

  it('removes page access tokens from cached pages service responses', async () => {
    const cachedUser = {
      pages: [{
        pageId: 'page_1',
        name: 'Page 1',
        accessToken: 'PAGE_ACCESS_TOKEN',
        access_token: 'PAGE_ACCESS_TOKEN_SNAKE',
        accounts: [{ accountId: 'act_1' }],
      }, {
        pageId: 'page_2',
        name: 'Page 2',
        accessToken: 'PAGE_ACCESS_TOKEN_2',
        accounts: [{ accountId: 'act_2' }],
      }],
    }
    const lean = jest.fn().mockResolvedValue(cachedUser)
    const select = jest.fn().mockReturnValue({ lean })
    jest.spyOn(FacebookUser, 'findOne').mockReturnValue({
      select,
    } as any)

    const pages = await getCachedPages('fb_123', 'act_1')

    expect(select).toHaveBeenCalledWith('pages adAccounts')
    expect(pages).toHaveLength(1)
    expect(pages[0]).toMatchObject({
      pageId: 'page_1',
      name: 'Page 1',
    })
    expect(pages[0]).not.toHaveProperty('accessToken')
    expect(pages[0]).not.toHaveProperty('access_token')
  })
})
