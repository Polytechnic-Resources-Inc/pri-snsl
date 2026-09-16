const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const files = fs.readdirSync(__dirname).filter(name => /^test_.*\.js$/.test(name)).sort();
let failed = 0;
for (const name of files) {
    console.log(`\n=== ${name} ===`);
    const result = spawnSync(process.execPath, [path.join(__dirname, name)], { stdio: 'inherit' });
    if (result.status !== 0) failed++;
}
console.log(`\n${files.length} test scripts; ${failed} failed`);
process.exitCode = failed ? 1 : 0;
