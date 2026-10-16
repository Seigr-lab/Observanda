// Module storage and transport share domain limits. Research notebook snapshot
// limits must not reject a valid single tool item (including UTF-8 content).
export const MODULE_BYTES=64*1024*1024;
export const MODULE_CHECKPOINT_BYTES=4*1024*1024;
export const LEGACY_CHECKPOINT_BYTES=2*1024*1024;
