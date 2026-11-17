'use strict';

/**
 * 打包 NSIS 安装包。
 *
 * 为什么不能直接跑 electron-builder：
 *
 *  1. NSIS 的 makensis.exe 是 ANSI 程序，electron-builder 通过命令行 /D 传给它的
 *     路径会按"非 Unicode 程序的语言"这个系统代码页转换。本项目的路径含中文
 *     （E:\软件开发\桌面时钟悬浮窗），在区域设置不是中文的机器上会变成乱码，
 *     构建直接失败。所以这里先建一个纯 ASCII 的目录联接（junction）指向项目，
 *     在联接路径下调用 electron-builder，输出也放到 ASCII 目录。
 *
 *  2. 上一次失败留下的 win-unpacked.tmp 会让下一次的 rename 报 EPERM，
 *     所以每次开工前先清干净。
 *
 * 产物最后拷回项目的 release/ 目录。
 */

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const PROJECT_DIR = path.resolve(__dirname, '..');
const RELEASE_DIR = path.join(PROJECT_DIR, 'release');
const VERSION = require(path.join(PROJECT_DIR, 'package.json')).version;

const isAscii = (s) => /^[\x20-\x7e]*$/.test(s);

function log(msg) {
  console.log(`[dist] ${msg}`);
}

/** 找一个纯 ASCII 的落脚点放联接与输出目录 */
function asciiBase() {
  const candidates = [os.tmpdir(), process.env.LOCALAPPDATA, 'C:\\'].filter(Boolean);
  for (const c of candidates) {
    if (!isAscii(c)) continue;
    try {
      fs.accessSync(c, fs.constants.W_OK);
      return c;
    } catch {
      /* 试下一个 */
    }
  }
  return null;
}

/** 建一个指向项目目录的 ASCII 联接；已存在且指对了就复用 */
function ensureJunction(linkPath) {
  try {
    if (fs.existsSync(linkPath)) {
      const stat = fs.lstatSync(linkPath);
      if (stat.isSymbolicLink()) {
        const target = path.resolve(fs.readlinkSync(linkPath).replace(/^\\\\\?\\/, ''));
        if (target.replace(/\\+$/, '') === PROJECT_DIR) return true;
      }
      fs.rmSync(linkPath, { recursive: false, force: true });
    }
    // junction 类型在 Windows 上不需要管理员权限，且可以跨盘
    fs.symlinkSync(PROJECT_DIR, linkPath, 'junction');
    return true;
  } catch (err) {
    log(`创建目录联接失败：${err.message}`);
    return false;
  }
}

/** 清掉上次失败留下的中间目录，否则这次 rename 会 EPERM */
function cleanStale(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    return;
  }
  for (const name of fs.readdirSync(dir)) {
    // 顺带清掉历史版本的安装包，否则下面会把旧版本一起拷回 release/
    const stale = name.endsWith('.tmp') || name === 'win-unpacked' || /-setup\.exe(\.blockmap)?$/i.test(name);
    if (!stale) continue;
    try {
      fs.rmSync(path.join(dir, name), { recursive: true, force: true });
      log(`已清理残留 ${name}`);
    } catch (err) {
      log(`清理 ${name} 失败（可能被杀毒软件占用）：${err.message}`);
    }
  }
}

function main() {
  const projectIsAscii = isAscii(PROJECT_DIR);
  let cwd = PROJECT_DIR;
  let outDir = RELEASE_DIR;

  if (!projectIsAscii) {
    const base = asciiBase();
    if (!base) {
      console.error(
        '[dist] 找不到可写的纯 ASCII 目录。请把项目移到不含中文的路径下再打包，\n' +
          '       或者把系统「非 Unicode 程序的语言」设为中文（简体，中国）后重启。'
      );
      process.exit(1);
    }
    const link = path.join(base, 'cclock-src');
    if (!ensureJunction(link)) process.exit(1);
    cwd = link;
    outDir = path.join(base, 'cclock-out');
    log(`项目路径含非 ASCII 字符，改用联接 ${link}`);
  }

  cleanStale(outDir);
  log(`开始打包 → ${outDir}`);

  const res = spawnSync(
    path.join(cwd, 'node_modules', '.bin', 'electron-builder.cmd'),
    // --publish never：在 GitHub Actions 的标签构建里，electron-builder 默认会尝试
    // 发布到 GitHub 并要求令牌；发布由工作流的 release 任务统一做，这里只打包
    [`--config.directories.output=${outDir}`, '--publish', 'never'],
    {
      cwd,
      stdio: 'inherit',
      shell: true,
      env: {
        ...process.env,
        // GitHub 直连不稳，走国内镜像（也可在 .npmrc 里配）
        ELECTRON_MIRROR: process.env.ELECTRON_MIRROR || 'https://npmmirror.com/mirrors/electron/',
        ELECTRON_BUILDER_BINARIES_MIRROR:
          process.env.ELECTRON_BUILDER_BINARIES_MIRROR ||
          'https://npmmirror.com/mirrors/electron-builder-binaries/'
      }
    }
  );

  if (res.status !== 0) {
    console.error(
      '\n[dist] 打包失败。最常见的原因是杀毒软件（如 360）的实时防护锁住了刚生成的 exe，\n' +
        '       表现为 EPERM / EBUSY / NSIS "failed opening file"。\n' +
        '       把项目目录和输出目录加入杀毒软件白名单，或临时关掉实时防护后重试。'
    );
    process.exit(res.status ?? 1);
  }

  // 产物拷回项目 release/
  if (outDir !== RELEASE_DIR) {
    fs.mkdirSync(RELEASE_DIR, { recursive: true });
    for (const name of fs.readdirSync(outDir)) {
      if (name !== `Cclock-${VERSION}-setup.exe`) continue;
      fs.copyFileSync(path.join(outDir, name), path.join(RELEASE_DIR, name));
      const mb = (fs.statSync(path.join(RELEASE_DIR, name)).size / 1024 / 1024).toFixed(1);
      log(`产物已拷到 release/${name}（${mb} MB）`);
    }
  }
  log('完成');
}

main();
