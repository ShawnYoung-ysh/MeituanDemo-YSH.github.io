import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';

const root = new URL('../', import.meta.url);
async function walk(directory) {
  return (await Promise.all((await readdir(new URL(directory, root), { withFileTypes: true })).map(entry =>
    entry.isDirectory() ? walk(`${directory}${entry.name}/`) : `${directory}${entry.name}`))).flat();
}
const paths = ['index.html', 'mock/db.json', ...await walk('assets/')];
const files = await Promise.all(paths.map(async path => {
  const data = await readFile(new URL(path, root));
  return { path, bytes: data.length, gzipEstimate: gzipSync(data).length };
}));
const totalBytes = files.reduce((sum, file) => sum + file.bytes, 0);
const gzipEstimate = files.reduce((sum, file) => sum + file.gzipEstimate, 0);
const seedBytes = files.find(file => file.path === 'mock/db.json').bytes;
const oversizedImages = files.filter(file => /\.(png|jpe?g|webp|gif|svg)$/i.test(file.path) && file.bytes > 150 * 1024);
const passed = gzipEstimate < 500 * 1024 && seedBytes < 100 * 1024 && oversizedImages.length === 0;
await mkdir(new URL('artifacts/', root), { recursive: true });
await writeFile(new URL('artifacts/resource-budget.json', root), JSON.stringify({ checkedAt: new Date().toISOString(), passed,
  scope: '本地静态资源体积；gzip 为逐文件估算，不代表 HTTP 实际传输或 Android/4G 可操作时间',
  totalBytes, gzipEstimate, seedBytes, oversizedImages, files }, null, 2));
console.log(`${passed ? 'PASS' : 'FAIL'} 静态体积：${files.length} 文件，原文 ${totalBytes} 字节，gzip 估算 ${gzipEstimate} 字节，种子 ${seedBytes} 字节；真机网络耗时待测。`);
process.exitCode = passed ? 0 : 1;
