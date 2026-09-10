export interface BridgeReleaseAsset {
  name: string
  browser_download_url: string
}

export const getLatestBridgeWindowsExe = async (): Promise<{ url: string; name: string } | null> => {
  try {
    const res = await fetch('https://api.github.com/repos/josegenecis/PopSystem/releases?per_page=20', {
      headers: { Accept: 'application/vnd.github+json' },
    })
    if (!res.ok) return null
    const releases = await res.json()
    if (!Array.isArray(releases)) return null

    const bridgeRelease = releases.find((r) => typeof r?.tag_name === 'string' && (r.tag_name.startsWith('pop-connect-v') || r.tag_name.startsWith('bridge-v')))
    if (!bridgeRelease) return null

    const assets: BridgeReleaseAsset[] = Array.isArray(bridgeRelease.assets) ? bridgeRelease.assets : []
    const exe = assets.find((a) => {
      const name = String(a?.name || '').toLowerCase()
      return name.endsWith('.exe') && name.includes('pop-connect-setup')
    })
    if (!exe?.browser_download_url || !exe?.name) return null
    return { url: exe.browser_download_url, name: exe.name }
  } catch {
    return null
  }
}
