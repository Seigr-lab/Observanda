// How many items of a record header collection one reading window holds.
// Galleries show reduced copies, so attachments page in larger windows.
export const RECORD_GALLERY_WINDOW=24;
export const headerWindowSize=name=>name==='attachments'?RECORD_GALLERY_WINDOW:4;
