import {convertPublicationRecord} from '../../src/publication-conversion-render.js';

// The website copy each record of a book would get, made by the conversion the
// application runs. Storage is needed only for stored media, fonts and plots.
export async function recordCopies(book,storage={},options={}){
 const copies=new Map();
 for(const record of book.entries)copies.set(record.id,await convertPublicationRecord(storage,book,record,options));
 return copies;
}
// Everything the copies would place on a website, as text.
export const copiesText=copies=>[...copies.values()].flatMap(copy=>[copy.html,copy.css,...copy.assets.map(asset=>asset.bytes?Buffer.from(asset.bytes).toString():'')]).join('\n');
