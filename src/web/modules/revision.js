// Legacy workspaces expose a counter; dedicated read owners expose an opaque
// revision of the requested domains. Entity revisions remain numeric.
export const validModuleRevision=value=>Number.isSafeInteger(value)&&value>=0||typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
