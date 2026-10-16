// A new draft has an explicit, absent identity in its saved selection. It must
// never turn an outline into a complete-workspace save or retain unrelated bodies.
export function recordCreationBase(snapshot,id){
 const {book,etag,recordScope,outline,notebookCounts,total}=snapshot;
 let counts=recordScope?.notebookCounts??(outline?notebookCounts:null);
 if(!counts){counts=Object.fromEntries(book.notebooks.map(n=>[n.id,0]));for(const record of book.entries)counts[record.notebookId]++;}
 return {book:{...book,entries:[]},etag,recordRevisions:{},
  recordScope:{ids:[id],missing:[id],notebookCounts:counts,total:recordScope?.total??(outline?total:book.entries.length)}};
}
