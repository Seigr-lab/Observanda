// A rendering/transfer working set, not a limit on the published selection.
export const PUBLIC_INDEX_ROWS=24;
export const publicIndexPath=page=>page===0?'browse.html':'browse-'+page+'.html';
export function publicIndexPage(path){
 if(path==='browse.html')return 0;
 const match=/^browse-([1-9]\d*)\.html$/.exec(path),page=match?Number(match[1]):null;
 return Number.isSafeInteger(page)?page:null;
}
