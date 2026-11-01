// Spreadsheet clients may ignore leading whitespace/control/format characters.
// Prefix these immediately, avoiding an unbounded scan/buffer of a text prefix.
// Typed numbers (including negatives) remain numbers; source JSON stays intact.
const unsafeStart=/^[=+\-@\uff1d\uff0b\uff0d\uff20\p{White_Space}\p{Cf}\u0000-\u001f\u007f-\u009f]/u;
const escape=value=>value.replaceAll('"','""');
export function csvCell(value){
 const text=String(value??'');return '"'+(typeof value==='string'&&unsafeStart.test(text)?"'":'')+escape(text)+'"';
}
export async function* csvCellChunks(chunks,{text=true}={}){
 yield '"';let first=true,pending='';
 for await(const chunk of chunks){
  if(typeof chunk!=='string')throw new TypeError('Invalid CSV text chunk');
  if(!chunk)continue;
  let value=pending+chunk;pending='';
  if(first){
   // At most one UTF-16 code unit is held to inspect a split leading scalar.
   if(value.length===1&&/[\uD800-\uDBFF]/.test(value)){pending=value;continue;}
   if(text&&unsafeStart.test(value))yield "'";first=false;
  }
  yield escape(value);
 }
 if(pending)yield escape(pending);yield '"';
}
