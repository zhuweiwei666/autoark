export const sanitizeFacebookPage = (page: any) => {
  const value = page && typeof page.toObject === 'function'
    ? page.toObject({ virtuals: true })
    : { ...(page || {}) }
  delete value.accessToken
  delete value.access_token
  return value
}

export const sanitizeFacebookPages = (pages: any[] = []) => pages.map(sanitizeFacebookPage)
