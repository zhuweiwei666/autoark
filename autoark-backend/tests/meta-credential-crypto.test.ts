import mongoose from 'mongoose'
import MetaBusinessCredential from '../src/models/MetaBusinessCredential'
import {
  decryptMetaToken,
  encryptMetaToken,
  fingerprintMetaToken,
} from '../src/utils/metaCredentialCrypto'

describe('Meta System User credential encryption', () => {
  const originalKey = process.env.META_CREDENTIAL_ENCRYPTION_KEY

  beforeEach(() => {
    process.env.META_CREDENTIAL_ENCRYPTION_KEY = 'test-only-meta-key-2026'
  })

  afterAll(() => {
    if (originalKey === undefined) {
      delete process.env.META_CREDENTIAL_ENCRYPTION_KEY
    } else {
      process.env.META_CREDENTIAL_ENCRYPTION_KEY = originalKey
    }
  })

  it('encrypts with randomized AES-GCM ciphertext and decrypts only with the configured key', () => {
    const token = 'SYSTEM_USER_SECRET_TOKEN'
    const first = encryptMetaToken(token)
    const second = encryptMetaToken(token)

    expect(first).not.toBe(second)
    expect(first).not.toContain(token)
    expect(decryptMetaToken(first)).toBe(token)
    expect(fingerprintMetaToken(token)).toMatch(/^[a-f0-9]{16}$/)

    process.env.META_CREDENTIAL_ENCRYPTION_KEY = 'different-test-key'
    expect(() => decryptMetaToken(first)).toThrow('Stored Meta credential could not be decrypted')
  })

  it('never serializes token ciphertext from the credential model', () => {
    const credential = new MetaBusinessCredential({
      organizationId: new mongoose.Types.ObjectId(),
      facebookAppId: new mongoose.Types.ObjectId(),
      credentialType: 'system_user',
      status: 'active',
      businessId: '123',
      systemUserId: '456',
      systemUserName: 'AutoArk Publisher Test',
      tokenCiphertext: encryptMetaToken('TOKEN_NOT_FOR_JSON'),
      tokenFingerprint: 'abcdef0123456789',
      assetGrants: {
        adAccounts: [],
        pages: [],
        pixels: [],
      },
    })

    const serialized = credential.toJSON() as any
    expect(serialized.tokenCiphertext).toBeUndefined()
    expect(JSON.stringify(serialized)).not.toContain('TOKEN_NOT_FOR_JSON')
  })
})
