// This file is a placeholder - the actual dev server runs from the project root
import { execSync } from 'child_process';
const projectRoot = '/home/z/my-project';
execSync('npx next dev -p 3000', { cwd: projectRoot, stdio: 'inherit' });
