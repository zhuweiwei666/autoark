import { Request, Response } from 'express'
import FbToken from '../models/FbToken'
import axios from 'axios'
import { FB_BASE_URL } from '../config/facebook.config'
import { combineFilters, scopedTokenFilter } from '../utils/accessControl'
import { pickSafeQueryString } from '../utils/pagination'

const FB_TOKEN_MAX_LENGTH = 4096

const sanitizeFacebookToken = (value: any): string | undefined => (
  pickSafeQueryString(value, FB_TOKEN_MAX_LENGTH)
)

export const saveFacebookToken = async (req: Request, res: Response) => {
  try {
    const token = sanitizeFacebookToken(req.body?.token)
    const userId = req.user?.userId

    if (!token) {
      return res.status(400).json({ error: 'Token is required' })
    }
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' })
    }

    // Validate token via FB API
    try {
      const check = await axios.get(
        `${FB_BASE_URL}/me`,
        {
          params: { access_token: token },
          timeout: 10000,
        },
      )

      if (!check.data || !check.data.id) {
        return res.status(400).json({ error: 'Invalid FB token' })
      }

      await FbToken.findOneAndUpdate(
        combineFilters({ fbUserId: check.data.id }, scopedTokenFilter(req)),
        {
          token,
          userId,
          organizationId: req.user?.organizationId,
          fbUserId: check.data.id,
          fbUserName: check.data.name,
          status: 'active',
          updatedAt: new Date(),
        },
        { new: true, upsert: true },
      )

      return res.json({
        message: 'Facebook token saved successfully',
        fbUser: check.data,
      })
    } catch (apiErr) {
      return res
        .status(400)
        .json({ error: 'Invalid Facebook Token (API verification failed)' })
    }
  } catch (err: any) {
    return res.status(500).json({ error: err.message })
  }
}
