import {
  parseLimitedNumber,
  parsePagination,
} from '../src/utils/pagination'

describe('pagination utilities', () => {
  it('normalizes invalid page values and caps page size', () => {
    expect(parsePagination({ page: '-2', pageSize: '10000' })).toEqual({
      page: 1,
      pageSize: 100,
      skip: 0,
    })
  })

  it('uses limit as a pageSize alias', () => {
    expect(parsePagination({ page: '3', limit: '50' })).toEqual({
      page: 3,
      pageSize: 50,
      skip: 100,
    })
  })

  it('caps standalone numeric limits', () => {
    expect(parseLimitedNumber('5000', 20, 200)).toBe(200)
    expect(parseLimitedNumber('bad', 20, 200)).toBe(20)
  })
})
