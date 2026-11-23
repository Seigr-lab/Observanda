// A workspace is open for reading and writing once the server reports it
// available. Every workspace keeps its records in its database, so a workspace
// that is not available (missing, moved, still loading) offers none of them.
export const workspaceAvailable=state=>state.storage?.available===true;
