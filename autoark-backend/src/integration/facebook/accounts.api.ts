import { facebookClient } from './facebookClient'

export const fetchUserAdAccounts = async (token?: string) => {
  const params: any = {
    fields:
      'id,account_status,name,currency,balance,spend_cap,amount_spent,disable_reason',
    limit: 500,
  }
  if (token) {
    params.access_token = token
  }
  const res = await facebookClient.get('/me/adaccounts', params)
  return res.data || []
}

