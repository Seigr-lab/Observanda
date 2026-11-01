// Cache implementation and native helpers activate only for an eligible query.
export async function queryResultWindow(options,produce){
 if(typeof options.workspace?.root!=='string'||!Buffer.isBuffer(options.workspace?.vault?.key))return null;
 const {pinnedQueryResults}=await import('./pinned-query-result.js');return pinnedQueryResults.window(options,produce);
}
