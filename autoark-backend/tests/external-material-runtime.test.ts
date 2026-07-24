import { resolveExternalMaterialRuntime } from '../src/services/externalMaterialRuntime.service'

describe('external material runtime status', () => {
  it.each([
    ['false', 'provider-key', false, 'disabled', false],
    ['true', '', false, 'unavailable', false],
    ['true', 'provider-key', true, 'paused', false],
    ['true', 'provider-key', false, 'active', true],
  ] as const)(
    'resolves flag=%s key=%s paused=%s as %s',
    (featureFlag, apiKey, paused, status, recurringEnabled) => {
      expect(resolveExternalMaterialRuntime(
        { paused, recurringEnabled: true },
        {
          EXTERNAL_MATERIAL_SYNC_ENABLED: featureFlag,
          GUANGDADA_API_KEY: apiKey,
        },
      )).toEqual({ status, recurringEnabled })
    },
  )

  it('keeps the stored recurring preference disabled when runtime gates are available', () => {
    expect(resolveExternalMaterialRuntime(
      { paused: false, recurringEnabled: false },
      {
        EXTERNAL_MATERIAL_SYNC_ENABLED: 'true',
        GUANGDADA_API_KEY: 'provider-key',
      },
    )).toEqual({ status: 'disabled', recurringEnabled: false })
  })
})
