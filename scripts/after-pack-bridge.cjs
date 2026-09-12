const path = require('path')
const { spawnSync } = require('child_process')

module.exports = async function afterPackBridge(context) {
  if (context.electronPlatformName !== 'darwin') return

  const appName = `${context.packager.appInfo.productFilename}.app`
  const appPath = path.join(context.appOutDir, appName)
  const result = spawnSync(
    'codesign',
    ['--force', '--deep', '--sign', '-', '--timestamp=none', appPath],
    { stdio: 'inherit' },
  )

  if (result.status !== 0) {
    throw new Error(`Falha ao aplicar assinatura ad-hoc completa ao ${appName}`)
  }
}
