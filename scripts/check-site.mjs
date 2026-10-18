import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2);
const urlIndex = args.indexOf('--url');
if (urlIndex >= 0 && !args[urlIndex + 1]) throw new Error('--url 后必须提供完整网址');
const target = urlIndex >= 0 ? new URL(args[urlIndex + 1]) : null;
const checks = [];
const add = (name, passed, detail = '') => checks.push({ name, passed, detail });
let html = '';
if (target) {
  const response = await fetch(target, { signal: AbortSignal.timeout(30000), redirect: 'follow' });
  add('未携带登录凭据的访问', response.status === 200, `HTTP ${response.status}`);
  add('固定网址', response.url === target.href, response.url);
  add('HTML 响应类型', /text\/html/i.test(response.headers.get('content-type') || ''));
  html = await response.text();
} else {
  html = await readFile(path.join(root, 'index.html'), 'utf8');
  add('首页文件', true, 'index.html');
  await readFile(path.join(root, '.nojekyll'));
  add('静态发布标识', true, '.nojekyll');
}
add('HTML 文档声明', /<!doctype html>/i.test(html));
add('中文语言设置', /<html\b[^>]*\blang=["']zh(?:-CN)?["']/i.test(html));
add('UTF-8 编码声明', /<meta\b[^>]*charset=["']?utf-8/i.test(html));
add('移动端 viewport 声明', /<meta\b[^>]*name=["']viewport["']/i.test(html));
add('页面标题', /<title>[^<]+<\/title>/i.test(html));
add('项目内容', html.includes('校园跑腿互助平台'));
const assets = new Set();
for (const tag of html.matchAll(/<(?:script|img|link)\b[^>]*>/gi)) {
  const source = tag[0].match(/\b(?:src|href)=["']([^"']+)["']/i)?.[1];
  if (source && !/^(?:data:|#|mailto:)/i.test(source)) assets.add(source);
}
for (const asset of assets) {
  if (target) {
    const assetUrl = new URL(asset, target);
    if (assetUrl.origin !== target.origin) { add(`资源 ${asset}`, false, '演示资源应随项目托管，避免外部服务影响评审'); continue; }
    add(`资源路径 ${asset}`, assetUrl.pathname.startsWith(target.pathname), '应位于项目子路径内');
    try {
      const response = await fetch(assetUrl, { signal: AbortSignal.timeout(15000) });
      const type = response.headers.get('content-type') || '';
      add(`资源访问 ${asset}`, response.ok && (!/\.(?:css|js|png|jpg|svg|webp)$/i.test(assetUrl.pathname) || !/text\/html/i.test(type)), `HTTP ${response.status}; ${type}`);
      await response.body?.cancel();
    } catch (error) { add(`资源访问 ${asset}`, false, error.message); }
  } else {
    if (/^(?:https?:)?\/\//i.test(asset)) { add(`资源 ${asset}`, false, '演示资源应随项目托管'); continue; }
    const relative = decodeURIComponent(asset.split(/[?#]/)[0]).replace(/^\/MeituanDemo-YSH\.github\.io\//, '');
    const file = path.resolve(root, relative);
    if (relative.startsWith('/') || path.relative(root, file).startsWith('..')) { add(`资源 ${asset}`, false, '资源路径越过项目目录'); continue; }
    try { await readFile(file); add(`资源 ${asset}`, true); } catch { add(`资源 ${asset}`, false, '文件不存在'); }
  }
}
const placeholder = html.includes('建设中');
if (args.includes('--require-demo')) add('已替换占位首页', !placeholder, '通过此项也不代表功能验收通过，仍须人工跑通演示流程');
const report = { checkedAt: new Date().toISOString(), target: target?.href || 'local-files', scope: '基础访问与静态文件检查；不包含业务功能或手机视觉验收', stage: placeholder ? 'placeholder' : 'requires-functional-review', passed: checks.every(check => check.passed), checks };
await mkdir(path.join(root, 'artifacts'), { recursive: true });
const filename = target ? (target.hostname.endsWith('github.io') ? 'check-live.json' : 'check-preview.json') : 'check-local.json';
await writeFile(path.join(root, 'artifacts', filename), `${JSON.stringify(report, null, 2)}\n`);
for (const check of checks) console.log(`${check.passed ? 'PASS' : 'FAIL'} ${check.name}${check.detail ? ` — ${check.detail}` : ''}`);
console.log(`阶段：${report.stage}；报告：artifacts/${filename}`);
process.exitCode = report.passed ? 0 : 1;
