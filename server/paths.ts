import path from 'path';
import { fileURLToPath } from 'url';

// Resolved from this file, which sits one level below the project root both in
// development (server/) and in the bundle (dist/). Modules in subdirectories
// import these instead of computing their own, which would be off by a level.
const here = path.dirname(fileURLToPath(import.meta.url));

export const ROOT = path.join(here, '..');
export const VIEWS_DIR = path.join(ROOT, 'views');
export const PUBLIC_DIR = path.join(ROOT, 'public');
export const DATA_DIR = path.join(ROOT, 'data');
export const FILES_DIR = path.join(DATA_DIR, 'files');
