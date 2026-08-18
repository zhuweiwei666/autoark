import {
  getMutableInsightsDates,
  getMutableInsightsWindow,
} from '../src/utils/shanghaiDate'

describe('Shanghai insights calendar windows', () => {
  it('keeps collectors inside today and the previous two calendar dates', () => {
    const beforeMidnight = new Date('2026-08-18T15:59:59.000Z')
    const afterMidnight = new Date('2026-08-18T16:00:00.000Z')

    expect(getMutableInsightsDates(beforeMidnight)).toEqual([
      '2026-08-18',
      '2026-08-17',
      '2026-08-16',
    ])
    expect(getMutableInsightsWindow(beforeMidnight)).toEqual({
      since: '2026-08-16',
      until: '2026-08-18',
    })
    expect(getMutableInsightsWindow(afterMidnight)).toEqual({
      since: '2026-08-17',
      until: '2026-08-19',
    })
  })
})
