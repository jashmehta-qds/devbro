import type { Configuration } from 'electron-builder'

const config: Configuration = {
  appId: 'com.devbro.app',
  productName: 'devbro',
  directories: {
    buildResources: 'build'
  },
  files: [
    'out/**/*',
    '!node_modules/**/*'
  ],
  mac: {
    target: 'dmg',
    category: 'public.app-category.developer-tools',
    icon: 'build/icon.png'
  },
  win: {
    target: 'nsis'
  },
  linux: {
    target: 'AppImage'
  },
  extraResources: [
    {
      from: 'build/icon.png',
      to: 'icon.png'
    },
    {
      from: 'resources/',
      to: './'
    }
  ]
}

export default config
