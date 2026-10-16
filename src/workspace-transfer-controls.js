// Destination-owned transfer control state is not part of retained research.
export const WORKSPACE_COPY_RECEIPT='.observanda/workspace-copy.observanda';
export const WORKSPACE_COPY_LEASE='.observanda/workspace-copy.lock';
export const WORKSPACE_BUNDLE_MOVE='.observanda/workspace-bundle-move.observanda';
export const WORKSPACE_BUNDLE_MOVE_LEASE='.observanda/workspace-bundle-move.lock';
const files=new Set([WORKSPACE_COPY_RECEIPT,WORKSPACE_COPY_LEASE,WORKSPACE_BUNDLE_MOVE,WORKSPACE_BUNDLE_MOVE_LEASE]);
export const workspaceTransferControl=relative=>files.has(relative);
