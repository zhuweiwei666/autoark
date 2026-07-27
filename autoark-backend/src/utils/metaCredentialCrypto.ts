import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'crypto'

const FORMAT_VERSION = 'v1'
const ALGORITHM = 'aes-256-gcm'
const AAD = Buffer.from('autoark:meta-business-credential:v1')

const getKeyMaterial = () => {
  const configured = process.env.META_CREDENTIAL_ENCRYPTION_KEY || process.env.JWT_SECRET
  if (!configured || configured === 'your-secret-key-change-in-production') {
    throw new Error(
      'META_CREDENTIAL_ENCRYPTION_KEY or JWT_SECRET must be configured before storing Meta credentials',
    )
  }
  return createHash('sha256').update(configured).digest()
}

export const fingerprintMetaToken = (token: string) => (
  createHash('sha256').update(token).digest('hex').slice(0, 16)
)

export const encryptMetaToken = (token: string) => {
  if (!token || typeof token !== 'string') {
    throw new Error('A non-empty Meta access token is required')
  }

  const iv = randomBytes(12)
  const cipher = createCipheriv(ALGORITHM, getKeyMaterial(), iv)
  cipher.setAAD(AAD)
  const encrypted = Buffer.concat([
    cipher.update(token, 'utf8'),
    cipher.final(),
  ])
  const authTag = cipher.getAuthTag()

  return [
    FORMAT_VERSION,
    iv.toString('base64url'),
    authTag.toString('base64url'),
    encrypted.toString('base64url'),
  ].join(':')
}

export const decryptMetaToken = (ciphertext: string) => {
  const [version, ivValue, tagValue, encryptedValue, ...extra] = String(ciphertext || '').split(':')
  if (
    version !== FORMAT_VERSION
    || !ivValue
    || !tagValue
    || !encryptedValue
    || extra.length > 0
  ) {
    throw new Error('Stored Meta credential has an unsupported encrypted format')
  }

  try {
    const decipher = createDecipheriv(
      ALGORITHM,
      getKeyMaterial(),
      Buffer.from(ivValue, 'base64url'),
    )
    decipher.setAAD(AAD)
    decipher.setAuthTag(Buffer.from(tagValue, 'base64url'))
    return Buffer.concat([
      decipher.update(Buffer.from(encryptedValue, 'base64url')),
      decipher.final(),
    ]).toString('utf8')
  } catch {
    throw new Error('Stored Meta credential could not be decrypted')
  }
}
