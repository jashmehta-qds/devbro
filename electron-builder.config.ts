import type { Configuration } from 'electron-builder'

const config: Configuration = {
  appId: 'com.devdashboard.app',
  productName: 'Dev Dashboard',
  directories: {
    buildResources: 'build'
  },
  files: [
    'out/**/*',
    '!node_modules/**/*'
  ],
  mac: {
    target: 'dmg',
    category: 'public.app-category.developer-tools'
  },
  win: {
    target: 'nsis'
  },
  linux: {
    target: 'AppImage'
  },
  extraResources: [
    {
      from: 'resources/',
      to: './'
    }
  ]
}

export default config
