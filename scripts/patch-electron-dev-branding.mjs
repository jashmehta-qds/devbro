import fs from 'node:fs'
import path from 'node:path'

const electronRoot = path.join(process.cwd(), 'node_modules/electron')
const distPath = path.join(electronRoot, 'dist')
const electronAppPath = path.join(distPath, 'Electron.app')
const devbroAppPath = path.join(distPath, 'devbro.app')
const pathTxtPath = path.join(electronRoot, 'path.txt')
const plistPath = path.join(
  devbroAppPath,
  'Contents/Info.plist'
)

if (fs.existsSync(electronAppPath) && !fs.existsSync(devbroAppPath)) {
  fs.renameSync(electronAppPath, devbroAppPath)
}

if (!fs.existsSync(plistPath)) {
  process.exit(0)
}

let plist = fs.readFileSync(plistPath, 'utf8')

plist = plist
  .replace(
    /<key>CFBundleDisplayName<\/key>\s*<string>.*?<\/string>/,
    '<key>CFBundleDisplayName</key>\n\t<string>devbro</string>'
  )
  .replace(
    /<key>CFBundleName<\/key>\s*<string>.*?<\/string>/,
    '<key>CFBundleName</key>\n\t<string>devbro</string>'
  )
  .replace(
    /<key>CFBundleIdentifier<\/key>\s*<string>.*?<\/string>/,
    '<key>CFBundleIdentifier</key>\n\t<string>com.devbro.app</string>'
  )

fs.writeFileSync(plistPath, plist)
fs.writeFileSync(pathTxtPath, 'devbro.app/Contents/MacOS/Electron')
