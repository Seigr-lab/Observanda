// How many items of a record header collection one reading window holds.
// Galleries show reduced copies, so attachments page in larger windows.
export const RECORD_GALLERY_WINDOW=24;
export const headerWindowSize=name=>name==='attachments'?RECORD_GALLERY_WINDOW:4;
// How many sections of a record one reading window holds: most records show whole.
// The service's window (src/record-content.js) is the same size.
export const RECORD_SECTION_WINDOW=12;
