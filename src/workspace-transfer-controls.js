// Destination-owned transfer control state is not part of retained research.
export const WORKSPACE_COPY_RECEIPT='.observanda/workspace-copy.observanda';
export const WORKSPACE_COPY_LEASE='.observanda/workspace-copy.lock';
export const PORTABLE_RESTORE_RECEIPT='.observanda/portable-restore.observanda';
export const WORKSPACE_BUNDLE_MOVE='.observanda/workspace-bundle-move.observanda';
export const WORKSPACE_BUNDLE_MOVE_LEASE='.observanda/workspace-bundle-move.lock';
export const WORKSPACE_MOVE_AUTHORIZATION='.observanda/workspace-move-authorization.observanda';
export const WORKSPACE_MOVE_CLEANUP_LEASE='.observanda/workspace-move-cleanup.lock';
export const WORKSPACE_RELOCATION_RECEIPT='.observanda/workspace-relocation.observanda';
const files=new Set([WORKSPACE_COPY_RECEIPT,WORKSPACE_COPY_LEASE,PORTABLE_RESTORE_RECEIPT,WORKSPACE_BUNDLE_MOVE,WORKSPACE_BUNDLE_MOVE_LEASE,WORKSPACE_MOVE_AUTHORIZATION,WORKSPACE_MOVE_CLEANUP_LEASE,WORKSPACE_RELOCATION_RECEIPT]);
export const workspaceTransferControl=relative=>files.has(relative);
