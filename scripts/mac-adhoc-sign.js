'use strict';
/* macOS 打包后做 ad-hoc 签名。

   没有 Apple 开发者证书时 electron-builder 会跳过签名，而它改过 Info.plist、
   Electron 自带的签名已经失效 —— Apple 芯片的机器会把这样的 app 判成「已损坏，无法打开」。
   用 "-" 作身份做一次 ad-hoc 签名，就变成可在「隐私与安全性」里手动放行的「无法验证开发者」。
   Windows 打包时这个钩子什么都不做。 */

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const app = path.join(context.appOutDir, context.packager.appInfo.productFilename + '.app');
  if (!fs.existsSync(app)) return;
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' });
  execFileSync('codesign', ['--verify', '--deep', '--strict', app], { stdio: 'inherit' });
  console.log('  • 已对 ' + path.basename(app) + ' 做 ad-hoc 签名并校验通过');
};
