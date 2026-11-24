import {timelineScope,timelineMatch,timelineOrder} from '../src/web/tools/timeline-model.js';
// The complete in-memory timeline, built from the product's scope, match and order rules.
export function timelineRecords(book,d){
 const ids=timelineScope(book,d),matches=timelineMatch(d);return book.entries.filter(r=>ids.has(r.notebookId)&&matches(r)).sort(timelineOrder(d));
}
