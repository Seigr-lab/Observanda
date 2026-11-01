// Bounds for individual commands, items and materialized legacy responses.
// Indexed collections and their retained history have no aggregate byte cap.
// Research snapshot limits must not reject a valid tool item, including UTF-8.
export const MODULE_BYTES=64*1024*1024;
export const MODULE_CHECKPOINT_BYTES=4*1024*1024;
export const LEGACY_CHECKPOINT_BYTES=2*1024*1024;
