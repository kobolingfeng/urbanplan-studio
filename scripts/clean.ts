import { existsSync, rmSync } from 'fs';
import { join, resolve } from 'path';

const ROOT = resolve(import.meta.dir, '..');
const targets = [
    join(ROOT, 'dist'),
    join(ROOT, 'release'),
    join(ROOT, 'artifacts'),
    join(ROOT, '.tmp-edge-profile'),
    join(ROOT, '.tmp-edge-profile-2'),
    join(ROOT, 'native', 'build'),
];

for (const target of targets) {
    if (existsSync(target)) {
        rmSync(target, { recursive: true, force: true });
        console.log(`removed ${target}`);
    }
}
