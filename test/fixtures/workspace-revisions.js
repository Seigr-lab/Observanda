// Earlier workspace revisions with their identity, revision number, time and
// record count, newest first, read through the revision reader record history uses.
export async function workspaceRevisions(workspace){
 const list=[];
 for await(const {id,book} of workspace.revisionSnapshots())list.push({id,revision:book.revision,updatedAt:book.updatedAt,entries:book.entries.length});
 return list.sort((a,b)=>b.revision-a.revision);
}
