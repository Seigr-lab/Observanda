import {recoveryValuePager} from '../src/web/record-recovery-value.js';
// The complete description, assembled from every window the review pager shows.
export function describeRecoveryValue(value,book,options={}){
 const pager=recoveryValuePager(value,book,options),parts=[];let page=pager.page();
 for(;;){parts.push(page.text);if(!page.next)return parts.join('');page=pager.next();}
}
