import { Request, Response } from 'express'
import FbToken from '../models/FbToken'
import axios from 'axios'

export const saveFacebookToken = async (req: Request, res: Response) => {
  try {
    const { token } = req.body
    const userId = 'default-user' // no login now

    if (!token) {
      return res.status(400).json({ error: 'Token is required' })
    }

    // Validate token via FB API
    try {
      const check = await axios.get(
        `https://graph.facebook.com/me?access_token=${token}`,
      )

      if (!check.data || !check.data.id) {
        return res.status(400).json({ error: 'Invalid FB token' })
      }

      await FbToken.findOneAndUpdate(
        { userId },
        { token, updatedAt: new Date() },
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
