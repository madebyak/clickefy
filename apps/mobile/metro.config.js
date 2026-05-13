// Learn more https://docs.expo.dev/guides/monorepos/
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

// 1. Watch the entire monorepo so changes to packages/* trigger reloads.
config.watchFolders = [workspaceRoot];

// 2. Resolve modules ONLY from the mobile app's node_modules and the
//    monorepo root. This prevents Metro from accidentally picking up
//    sibling apps' dependencies (e.g. admin's React 19.2 vs Expo's 19.1).
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

// 3. Disable hierarchical lookup so we don't walk up beyond the workspace
//    root when resolving — eliminates the duplicate-React class of bugs.
config.resolver.disableHierarchicalLookup = true;

module.exports = config;
