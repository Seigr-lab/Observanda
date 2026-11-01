// Shared names without storage-owner imports, so low-level filesystem helpers
// do not load the workspace and project lifecycle dependency graph.
export const DELETE_MARKER='.observanda/delete-workspace.json';
export const MOVE_RECEIPT='.observanda/workspace-move.json';
export const MOVE_SOURCE='.observanda/move-source.json';
