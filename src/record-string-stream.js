// Validate the exact JSON.stringify string encoding retained by record blocks.
// Keep only decoder state and one escape, even when a scalar spans many blocks.
// Output excludes serialize()'s final newline so it fits either JSON traversal.
import {AppError} from './errors.js';

const fail=()=>{throw new AppError('CATALOGUE_DAMAGED');};
// Serialize logical text windows as one JSON string. Keep only an unfinished
// surrogate pair across windows, so the output matches JSON.stringify exactly.
export async function* recordTextJSON(chunks,{signal}={}){
 signal?.throwIfAborted();let high='';yield '"';
 for await(const chunk of chunks){
  signal?.throwIfAborted();if(typeof chunk!=='string')throw new AppError('INVALID');
  for(let offset=0;offset<chunk.length;offset+=8192){
   signal?.throwIfAborted();
   let text=high+chunk.slice(offset,offset+8192);high='';const last=text.charCodeAt(text.length-1);
   if(last>=0xd800&&last<=0xdbff){high=text.at(-1);text=text.slice(0,-1);}
   yield JSON.stringify(text).slice(1,-1);
  }
 }
 signal?.throwIfAborted();yield JSON.stringify(high).slice(1,-1)+'"';
}
export async function* recordStringJSON(chunks,{signal}={}){
 const decoder=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true});
 let phase='start',escape='',highSurrogate=false;
 function validate(text){
  for(const character of text){
   if(phase==='start'){if(character!=='"')fail();phase='body';continue;}
   if(phase==='closed'){if(character!=='\n')fail();phase='done';continue;}
   if(phase==='done')fail();
   if(phase==='escape'){
    escape+=character;
    if(escape==='\\u')continue;
    if(escape.startsWith('\\u')&&escape.length<6){if(!/^[0-9a-f]$/.test(character))fail();continue;}
    let value;try{value=JSON.parse('"'+escape+'"');}catch{fail();}
    if(JSON.stringify(value)!=='"'+escape+'"')fail();
    const code=value.charCodeAt(0);
    // Adjacent escaped halves would serialize as the literal Unicode pair.
    if(highSurrogate&&code>=0xdc00&&code<=0xdfff)fail();
    highSurrogate=code>=0xd800&&code<=0xdbff;escape='';phase='body';continue;
   }
   if(character==='"'){phase='closed';continue;}
   if(character==='\\'){phase='escape';escape='\\';continue;}
   if(character.codePointAt(0)<0x20)fail();
   highSurrogate=false;
  }
  return phase==='done'?text.slice(0,-1):text;
 }
 for await(const bytes of chunks){
  signal?.throwIfAborted();let text;
  try{text=decoder.decode(bytes,{stream:true});}catch{fail();}
  const output=validate(text);if(output)yield output;
 }
 signal?.throwIfAborted();let tail;
 try{tail=decoder.decode();}catch{fail();}
 const output=validate(tail);if(output)yield output;
 if(phase!=='done')fail();
}

// Decode the authenticated canonical string incrementally. In particular an
// escaped code unit or a UTF-8 character may straddle retained byte windows.
export async function* recordStringText(chunks,{signal}={}){
 let phase='start',escape='';
 for await(const text of recordStringJSON(chunks,{signal})){
  let output='';
  for(const character of text){
   if(phase==='start'){phase='body';continue;}
   if(phase==='escape'){
    escape+=character;
    if(escape==='\\u'||escape.startsWith('\\u')&&escape.length<6)continue;
    output+=JSON.parse('"'+escape+'"');escape='';phase='body';continue;
   }
   if(character==='"'){phase='done';continue;}
   if(character==='\\'){escape='\\';phase='escape';continue;}
   output+=character;
  }
  if(output)yield output;
 }
 if(phase!=='done')fail();
}
