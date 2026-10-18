import { readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = new URL('../assets/js/', import.meta.url);
let count = 0;
async function check(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = new URL(entry.name + (entry.isDirectory() ? '/' : ''), directory);
    if (entry.isDirectory()) await check(file);
    else if (entry.name.endsWith('.js')) {
      const result = spawnSync(process.execPath, ['--check', fileURLToPath(file)], { encoding: 'utf8' });
      if (result.status !== 0) throw new Error(result.stderr || `无法检查 ${file.pathname}`);
      count++;
    }
  }
}
await check(root);
console.log(`PASS JavaScript：${count} 个浏览器模块语法检查通过。`);
