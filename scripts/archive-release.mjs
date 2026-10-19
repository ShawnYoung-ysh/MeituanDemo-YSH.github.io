// Archive exact committed files; generated evidence and browser records stay local.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const git = args => execFileSync('git', args, { cwd: root, maxBuffer: 16 * 1024 * 1024 });
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

async function main() {
  if (git(['status', '--porcelain', '--untracked-files=normal']).toString().trim()) {
    throw new Error('请先检查并提交工作区；归档仅打包已提交版本。');
  }
  const commit = git(['rev-parse', 'HEAD']).toString().trim();
  const { version } = JSON.parse(git(['show', 'HEAD:package.json']).toString());
  if (!/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(version)) throw new Error('版本格式无效。');
  if (!git(['show', 'HEAD:index.html']).toString().includes(`v${version}`)) throw new Error('页面版本与 package.json 不一致。');
  const files = git(['ls-tree', '-r', '--name-only', '-z', 'HEAD']).toString().split('\0').filter(Boolean);
  const siteFiles = files.filter(name => name === '.nojekyll' || name === 'index.html' || name.startsWith('assets/') || name.startsWith('mock/'));
  for (const required of ['.nojekyll', 'index.html', 'mock/db.json', 'docs/DEMO_WALKTHROUGH.md', 'docs/RELEASE_REPORT.md', 'docs/DELIVERY.md']) {
    if (!files.includes(required)) throw new Error(`缺少交付文件：${required}`);
  }
  const key = `v${version}-${commit.slice(0, 7)}`;
  const parent = path.join(root, 'artifacts', 'releases');
  const output = path.join(parent, key);
  await mkdir(parent, { recursive: true });
  // Refuse to overwrite a previous delivery, including a partially generated one.
  await mkdir(output);
  const archives = [];
  for (const [kind, entries] of [['source', files], ['site', siteFiles]]) {
    const filename = `campus-errand-${key}-${kind}.zip`;
    const destination = path.join(output, filename);
    git(['archive', '--format=zip', `--output=${destination}`, commit, ...(kind === 'site' ? ['--', '.nojekyll', 'index.html', 'assets', 'mock'] : [])]);
    const bytes = await readFile(destination);
    const manifest = entries.map(name => {
      const contents = git(['show', `${commit}:${name}`]);
      return { path: name, bytes: contents.length, sha256: hash(contents) };
    });
    archives.push({ kind, filename, bytes: bytes.length, sha256: hash(bytes), files: manifest });
  }
  const release = {
    version, commit, generatedAt: new Date().toISOString(),
    site: 'https://shawnyoung-ysh.github.io/MeituanDemo-YSH.github.io/',
    acceptance: '归档成功不代表发布门槛通过；状态及待测条件见 docs/RELEASE_REPORT.md 与 docs/MOBILE_TEST_REPORT.md。',
    archives,
  };
  await writeFile(path.join(output, 'release.json'), `${JSON.stringify(release, null, 2)}\n`);
  await writeFile(path.join(output, 'SHA256SUMS.txt'), `${archives.map(item => `${item.sha256}  ${item.filename}`).join('\n')}\n`);
  console.log(`归档已生成：${output}`);
  for (const item of archives) console.log(`${item.kind}: ${item.filename}，${item.files.length} 文件，${item.bytes} 字节`);
}

main().catch(error => { console.error(`归档失败：${error.message}`); process.exitCode = 1; });
