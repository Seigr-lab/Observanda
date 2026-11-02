// Source permissions bound every website and edition choice. Originals remain
// intact for authenticated reading and revision recovery.
import {publicationPartAllowed} from './record-publication-privacy.js';
// Existing version-one records without part overrides have the same projection.
// A new override invalidates all dependent projections in its record write.
export const SOURCE_PUBLICATION_VERSION=1;
export const sourceNotebookAllowed=(book,target='website')=>!!book&&(target==='website'?book.share!==false:target==='pdf'&&book.sharePdf===true);
export const sourceRecordAllowed=(record,metadata,target='website')=>(target==='website'?record.share===true:target==='pdf'&&record.sharePdf===true)&&(!metadata||metadata.notebooks.some(book=>book.id===record.notebookId&&sourceNotebookAllowed(book,target)));
export const publicRecordSections=(record,target='website')=>(record.sections??[]).filter(section=>target==='website'?section.share!==false:target==='pdf'&&section.sharePdf===true);
export const publicRecordAttachments=(record,target='website')=>(record.attachments??[]).filter(item=>target==='website'?item.share===true:target==='pdf'&&item.sharePdf===true);
export function sourcePublicationRecord(record,target='website'){
 const result={...record,sections:publicRecordSections(record,target),attachments:publicRecordAttachments(record,target)};
 for(const key of ['body','outcome'])if(!publicationPartAllowed(record,key,target))result[key]='';
 for(const key of ['contributors','tags','figures','relations'])if(!publicationPartAllowed(record,key,target))result[key]=[];
 for(const key of ['results','attempt','template'])if(!publicationPartAllowed(record,key,target))delete result[key];
 // Consent and withheld values never become website content or public metadata.
 delete result.publication;return result;
}
