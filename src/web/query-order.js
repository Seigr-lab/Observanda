// A cursor's order is part of its contract, independent of the host's locale.
// Bump this version when changing comparisons so an older cursor cannot skip
// or duplicate records under a new ordering rule.
export const QUERY_ORDER_VERSION=1;
export const compareKey=(a,b)=>a<b?-1:a>b?1:0;
const titles=new Intl.Collator('en',{numeric:true});
export const compareTitles=(a,b)=>titles.compare(a,b);
export const recentRecordOrder=(a,b)=>compareKey(b.updatedAt,a.updatedAt)||compareKey(a.id,b.id);
