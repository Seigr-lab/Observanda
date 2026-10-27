// Shared by owner dispatch and the editor executor so new operations cannot
// silently work in workspaces while disappearing from independent projects.
export const websiteEditorReads=Object.freeze(['open','window','item','sources','template-review']);
export const websiteEditorMutations=Object.freeze(['change','undo','redo','discard','save']);
export const websiteEditorOperations=Object.freeze([...websiteEditorReads,...websiteEditorMutations]);
