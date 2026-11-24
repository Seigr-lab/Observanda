// One UTF-16 search vocabulary for writers, readers and independent audits.
export const SEARCH_BLOCK_SIZE=256;
export const bitmapHex=value=>value.toString(16).padStart(64,'0');
const ordinal=value=>String(value).padStart(16,'0');
export const positionKey=position=>'position:'+ordinal(position);
export const termPrefix=(notebookId,gram)=>'book:'+notebookId+':gram:'+gram+':';
const gramKey=value=>Array.from({length:value.length},(_,i)=>value.charCodeAt(i).toString(16).padStart(4,'0')).join('');
export function grams(text,width){
 const windows=new Set();
 for(let i=0;i<=text.length-width;i++)windows.add(text.slice(i,i+width));
 return new Set([...windows].map(gramKey));
}
export const referenceTerm=target=>'ref-'+target.workspaceId+'-'+target.id;
export const wordKey=(row,gram)=>termPrefix(row.notebookId,gram)+ordinal(Math.floor(row.position/SEARCH_BLOCK_SIZE));
