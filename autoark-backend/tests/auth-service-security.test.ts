const mockUserFindOne = jest.fn()

jest.mock('../src/models/User', () => {
  const actual = jest.requireActual('../src/models/User')
  return {
    __esModule: true,
    ...actual,
    default: {
      findOne: mockUserFindOne,
    },
  }
})

jest.mock('../src/models/Organization', () => ({
  __esModule: true,
  default: {
    findById: jest.fn(),
  },
}))

jest.mock('../src/utils/jwt', () => ({
  generateToken: jest.fn(() => 'jwt-token'),
}))

import authService from '../src/services/auth.service'

const populateQuery = (value: any) => ({
  populate: jest.fn().mockResolvedValue(value),
})

describe('auth service input guardrails', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('rejects object usernames before querying users', async () => {
    await expect(
      authService.login({
        username: { $ne: 'admin' } as any,
        password: 'secret123',
      }),
    ).rejects.toThrow('用户名或密码错误')

    expect(mockUserFindOne).not.toHaveBeenCalled()
  })

  it('trims safe usernames before querying users', async () => {
    mockUserFindOne.mockReturnValue(populateQuery(null))

    await expect(
      authService.login({
        username: '  admin  ',
        password: 'secret123',
      }),
    ).rejects.toThrow('用户名或密码错误')

    expect(mockUserFindOne).toHaveBeenCalledWith({ username: 'admin' })
  })
})
