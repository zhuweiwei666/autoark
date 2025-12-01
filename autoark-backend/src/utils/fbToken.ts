import FbToken from '../models/FbToken'

export const getFacebookAccessToken = async () => {
  const saved = await FbToken.findOne({ userId: 'default-user' })
  if (!saved)
    throw new Error('Facebook token not found. Please set it in Settings.')
  return saved.token
}
