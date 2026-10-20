// Source permissions bound every website and edition choice. Originals remain
// intact for authenticated reading and revision recovery.
export const SOURCE_PUBLICATION_VERSION=1;
export const sourceNotebookAllowed=book=>book?.share!==false;
export const sourceRecordAllowed=(record,metadata)=>record.share===true&&(!metadata||metadata.notebooks.some(book=>book.id===record.notebookId&&sourceNotebookAllowed(book)));
export const publicRecordSections=record=>(record.sections??[]).filter(section=>section.share!==false);
export function sourcePublicationRecord(record){return {...record,sections:publicRecordSections(record),attachments:(record.attachments??[]).filter(attachment=>attachment.share===true)};}
