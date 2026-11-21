import {recordProjection} from '../../src/publication-conversion-render.js';
import {renderRecordPage} from '../../src/publication.js';

// The renderer's page for one shared record, built from the projection its
// website copy is made from, with media and fonts supplied in memory.
export const recordPage=(book,record,options={})=>renderRecordPage(recordProjection(book,{...record,share:true}),{editionParts:{},...options});
