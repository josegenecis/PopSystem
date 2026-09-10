const { spawnSync } = require('child_process')
const path = require('path')
const fs = require('fs')

const run = (cmd, args, cwd, env) => {
  const res = spawnSync(cmd, args, { cwd, stdio: 'inherit', shell: process.platform === 'win32', env: env || process.env })
  if (res.status !== 0) process.exit(res.status || 1)
}

const root = process.cwd()
const nativeBridgeDir = path.join(root, 'native-bridge')

const shimDir = path.join(root, '.bridge-build-bin')
fs.mkdirSync(shimDir, { recursive: true })
if (process.platform !== 'win32') {
  const pythonShim = path.join(shimDir, 'python')
  if (!fs.existsSync(pythonShim)) {
    fs.writeFileSync(pythonShim, '#!/usr/bin/env sh\nexec python3 "$@"\n')
    fs.chmodSync(pythonShim, 0o755)
  }
} else {
  const pythonShim = path.join(shimDir, 'python.cmd')
  if (!fs.existsSync(pythonShim)) {
    fs.writeFileSync(pythonShim, '@echo off\r\npython.exe %*\r\n')
  }
}

const env = {
  ...process.env,
  PATH: `${shimDir}${path.delimiter}${process.env.PATH || ''}`,
  PYTHON: process.platform === 'darwin' ? '/usr/bin/python3' : (process.platform === 'win32' ? 'python' : 'python3'),
}
env.npm_config_python = env.PYTHON

if (process.platform !== 'win32') {
  env.CXXFLAGS = env.CXXFLAGS ? `${env.CXXFLAGS} -std=c++20` : '-std=c++20'
  env.CFLAGS = env.CFLAGS ? `${env.CFLAGS} -std=c++20` : '-std=c++20'
  env.npm_config_cxxflags = env.CXXFLAGS
} else {
  env.CL = env.CL ? `${env.CL} /std:c++20` : '/std:c++20'
}

run('npm', ['install', '--no-audit', '--no-fund'], nativeBridgeDir, env)
const electronVersion = require(path.join(root, 'node_modules', 'electron', 'package.json')).version
run('npx', ['electron-rebuild', '-f', '-m', nativeBridgeDir, '-v', electronVersion, '-w', 'serialport,@thiagoelg/node-printer'], root, env)
const extra = process.argv.includes('--dir') ? ['--dir'] : []
run('npx', ['electron-builder', '--config', 'electron-builder.bridge.json', '--publish=never', ...extra], root, env)
