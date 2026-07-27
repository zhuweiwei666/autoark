import TargetingPackage from '../src/models/TargetingPackage'

describe('TargetingPackage Facebook targeting', () => {
  it('preserves an iOS-only device restriction in the Meta targeting payload', () => {
    const targetingPackage: any = new TargetingPackage({
      name: 'autoark-leyon',
      placement: {
        type: 'manual',
        platforms: ['facebook', 'instagram', 'messenger', 'audience_network'],
        devicePlatforms: ['mobile'],
      },
      deviceSettings: {
        mobileOS: ['iOS'],
        mobileDevices: ['iphone_all', 'ipad_all', 'ipod_all'],
        iosVersionMin: '16.0',
      },
    })

    expect(targetingPackage.toFacebookTargeting()).toMatchObject({
      publisher_platforms: ['facebook', 'instagram', 'messenger', 'audience_network'],
      device_platforms: ['mobile'],
      user_os: ['iOS_ver_16.0_and_above'],
    })
  })

  it('keeps generic iOS targeting when no minimum version is configured', () => {
    const targetingPackage: any = new TargetingPackage({
      name: 'iOS all versions',
      deviceSettings: {
        mobileOS: ['iOS'],
      },
    })

    expect(targetingPackage.toFacebookTargeting()).toMatchObject({
      user_os: ['iOS'],
    })
  })

  it('does not add an OS restriction when the package explicitly targets all operating systems', () => {
    const targetingPackage: any = new TargetingPackage({
      name: 'all devices',
      deviceSettings: {
        mobileOS: ['all'],
      },
    })

    expect(targetingPackage.toFacebookTargeting()).not.toHaveProperty('user_os')
  })
})
