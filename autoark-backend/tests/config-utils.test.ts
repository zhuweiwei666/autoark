import { parsePositiveInteger } from '../src/utils/config'

describe('config utils', () => {
  it('falls back when positive integer env values are invalid', () => {
    expect(parsePositiveInteger(undefined, 20)).toBe(20)
    expect(parsePositiveInteger('not-a-number', 20)).toBe(20)
    expect(parsePositiveInteger('0', 20)).toBe(20)
    expect(parsePositiveInteger('-5', 20)).toBe(20)
  })

  it('normalizes valid positive numbers to integers', () => {
    expect(parsePositiveInteger('3', 20)).toBe(3)
    expect(parsePositiveInteger('3.8', 20)).toBe(3)
  })
})
