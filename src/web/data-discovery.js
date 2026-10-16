// Shared matching and transport contract for feature-owned card discovery.
export const DISCOVERY_PAGE_SIZE=12;
export const discoveryMatches=(item,search)=>search.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean).every(word=>(item.title+' '+(item.subtitle??'')).toLocaleLowerCase().includes(word));
export function validDiscoveryPage(value,{offset,limit}){
 return value&&Array.isArray(value.items)&&value.items.length<=limit&&value.items.every(item=>item&&typeof item.key==='string'&&item.key.length>0&&typeof item.title==='string'&&(item.subtitle===undefined||typeof item.subtitle==='string'))&&
  new Set(value.items.map(item=>item.key)).size===value.items.length&&Number.isSafeInteger(value.total)&&value.total>=0&&value.offset===offset&&value.items.length===Math.min(limit,Math.max(0,value.total-offset));
}
