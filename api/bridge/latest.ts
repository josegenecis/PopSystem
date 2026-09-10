const OWNER = 'josegenecis'
const REPO = 'PopSystem'

const disableRedirectCache = (res: any) => {
  res.setHeader('cache-control', 'no-store, no-cache, must-revalidate, proxy-revalidate')
  res.setHeader('pragma', 'no-cache')
  res.setHeader('expires', '0')
}

export default async function handler(_req: any, res: any) {
  const fallback = `https://github.com/${OWNER}/${REPO}/releases`
  try {
    const response = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/releases?per_page=100`, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'popsystem-web',
      },
    })

    if (!response.ok) throw new Error(`github_${response.status}`)

    const releases: any[] = await response.json()
    const release = Array.isArray(releases)
      ? releases.find((item: any) => {
          const tag = String(item?.tag_name || '')
          return !item?.draft && !item?.prerelease && tag.startsWith('bridge-v')
        })
      : null
    const assets: any[] = Array.isArray(release?.assets) ? release.assets : []
    const installer = assets.find((item: any) => {
      const name = String(item?.name || '').toLowerCase()
      return name.endsWith('.exe') && name.includes('pop-connect-setup')
    })
    const url = String(installer?.browser_download_url || '') || fallback

    res.statusCode = 302
    res.setHeader('location', url)
    disableRedirectCache(res)
    res.end()
  } catch {
    res.statusCode = 302
    res.setHeader('location', fallback)
    disableRedirectCache(res)
    res.end()
  }
}
