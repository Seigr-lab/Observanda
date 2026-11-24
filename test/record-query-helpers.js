import {recordQueryMatcher,recordQueryOrder} from '../src/web/record-query.js';
// Filters and orders records in memory with the product's shared query semantics.
export function queryRecords(records,query={}){
 return records.filter(recordQueryMatcher(query)).sort(recordQueryOrder(query.browse));
}
