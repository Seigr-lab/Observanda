// Evidence needs a record's identity and selected presentation values, not its
// complete narrative. History authenticates the canonical content revision.
export async function materialRecordSummary(store,row){
 if(!row)return null;
 const index=store.historyIndex(row.id),found=await index.lookup(await index.head(),'version',row.revision),view=await index.display(found.item);
 return {id:row.id,notebookId:row.notebookId,title:view.title,revision:view.revision};
}
