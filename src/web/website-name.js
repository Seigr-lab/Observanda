// Display spelling remains authored; comparison ignores case and spacing.
export const websiteNameKey=name=>typeof name==='string'?name.normalize('NFKC').trim().replace(/\s+/gu,' ').toLowerCase():'';
export const validWebsiteName=name=>typeof name==='string'&&name.trim().length>0&&name.length<=160&&!/[\x00-\x1f]/.test(name);
