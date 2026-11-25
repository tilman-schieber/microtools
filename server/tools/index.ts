import type { Category, Tool } from './shared';
import { CATEGORIES } from './shared';
import { polls } from './polls';
import { potluck } from './potluck';
import { expenses } from './expenses';
import { notes } from './notes';
import { files } from './files';
import { secrets } from './secrets';
import { micropageTool } from './micropage';
import { passwords } from './passwords';
import { clock } from './clock';
import { test } from './test';

export type { Tool, Category } from './shared';
export { CATEGORIES } from './shared';

/**
 * Every tool, in the order the landing page lists them within their group.
 * Adding a tool: write server/tools/<name>.ts, add it here, and add
 * tool.<id>.name and tool.<id>.desc to the locales.
 */
export const TOOLS: readonly Tool[] = [
  polls, potluck, expenses,
  notes, files, secrets, micropageTool,
  passwords, clock, test
];

/** The landing page's groups, each with its tools, empty groups left out */
export function toolGroups(): Array<{ category: Category; tools: Tool[] }> {
  return CATEGORIES
    .map((category) => ({ category, tools: TOOLS.filter((t) => t.category === category) }))
    .filter((g) => g.tools.length > 0);
}
