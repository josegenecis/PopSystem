import type { VercelRequest, VercelResponse } from '@vercel/node'

type GitHubAsset = {
  name?: string
  browser_download_url?: string
}

type GitHubRelease = {
  tag_name?: string
  draft?: boolean
  prerelease?: boolean
  assets?: GitHubAsset[]
}

const RELEASES_URL = 'https://api.github.com/repos/josegenecis/PopSystem/releases?per_page=100'

export default async function handler(_req: VercelRequest, res: VercelResponse) {
  try {
    const response = await fetch(RELEASES_URL, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'PopSystem-PWA',
      },
    })

    if (!response.ok) {
      throw new Error(`GitHub respondeu ${response.status}`)
    }

    const releases = (await response.json()) as GitHubRelease[]
    const release = releases.find(
      (item) =>
        !item.draft &&
        !item.prerelease &&
        typeof item.tag_name === 'string' &&
        item.tag_name.startsWith('bridge-v'),
    )
    const executableAssets = release?.assets?.filter(
      (asset) => typeof asset.name === 'string' && asset.name.toLowerCase().endsWith('.exe'),
    ) ?? []
    const installer = executableAssets.find((asset) => {
      const name = asset.name?.toLowerCase() ?? ''
      const normalizedName = name.replace(/[^a-z0-9]/g, '')
      return normalizedName.startsWith('popconnectsetup')
    })

    if (!installer?.browser_download_url) {
      return res.status(404).json({ error: 'Instalador do PopConnect não encontrado.' })
    }

    res.setHeader('Cache-Control', 'no-store, max-age=0')
    return res.redirect(302, installer.browser_download_url)
  } catch (error) {
    console.error('[bridge/latest] Falha ao localizar instalador:', error)
    return res.status(503).json({ error: 'Instalador do PopConnect temporariamente indisponível.' })
  }
}
