type ApiRequest = {
  query?: Record<string, string | string[] | undefined>
}

type ApiResponse = {
  status: (statusCode: number) => ApiResponse
  json: (body: unknown) => unknown
  send: (body: string) => unknown
  setHeader: (name: string, value: string) => unknown
  redirect: (statusCode: number, location: string) => unknown
}

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

const getVersion = (tag: string) => {
  const match = tag.match(/^(?:bridge-v|pop-connect-v)(\d+)\.(\d+)\.(\d+)$/)
  return match ? match.slice(1).map(Number) : null
}

const compareVersions = (left: number[], right: number[]) => {
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return right[index] - left[index]
  }
  return 0
}

export default async function handler(req: ApiRequest, res: ApiResponse) {
  try {
    const rawAsset = req.query?.asset
    const requestedAsset = decodeURIComponent(Array.isArray(rawAsset) ? rawAsset[0] : String(rawAsset || ''))
    if (!requestedAsset || requestedAsset.includes('/') || requestedAsset.includes('\\')) {
      return res.status(400).json({ error: 'Arquivo de atualização inválido.' })
    }

    const response = await fetch(RELEASES_URL, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'Pop-Connect-Updater',
      },
    })
    if (!response.ok) throw new Error(`GitHub respondeu ${response.status}`)

    const releases = (await response.json()) as GitHubRelease[]
    const release = releases
      .filter((item) => !item.draft && !item.prerelease && getVersion(String(item.tag_name || '')))
      .sort((left, right) => compareVersions(
        getVersion(String(left.tag_name)) || [0, 0, 0],
        getVersion(String(right.tag_name)) || [0, 0, 0],
      ))[0]
    const asset = release?.assets?.find((item) => item.name === requestedAsset)
    if (!asset?.browser_download_url) {
      return res.status(404).json({ error: 'Atualização do Pop Connect não encontrada.' })
    }

    res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=60, stale-while-revalidate=300')
    if (requestedAsset === 'latest.yml') {
      const metadata = await fetch(asset.browser_download_url, {
        headers: { 'User-Agent': 'Pop-Connect-Updater' },
      })
      if (!metadata.ok) throw new Error(`Falha ao baixar latest.yml: ${metadata.status}`)
      res.setHeader('Content-Type', 'text/yaml; charset=utf-8')
      return res.status(200).send(await metadata.text())
    }

    return res.redirect(302, asset.browser_download_url)
  } catch (error) {
    console.error('[bridge/update] Falha ao localizar atualização:', error)
    return res.status(503).json({ error: 'Atualização do Pop Connect temporariamente indisponível.' })
  }
}
