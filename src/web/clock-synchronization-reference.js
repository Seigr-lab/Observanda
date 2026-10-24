export const materialReferenceEqual=(a,b)=>!!a&&!!b&&a.kind===b.kind&&a.id===b.id&&a.revision===b.revision&&(a.workspaceId??null)===(b.workspaceId??null);
