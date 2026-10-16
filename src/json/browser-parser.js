// Use the same maintained tokenizer as server-side checkpoint inspection.
// This decoder retains the selected value, but never a second complete JSON
// document. Callers must authenticate the bytes before exposing finish().
import {jsonParser} from 'stream-json/core/parser.js';
import Assembler from 'stream-json/core/assembler.js';
import {none,isMany,getManyValues} from 'stream-chain/core';

export function incrementalJSONDecoder(){
 let parser=jsonParser({streamValues:false,streamStrings:true,packStrings:false}),assembler=new Assembler(),started=false,fragments=[],strings=[];
 const flushString=()=>{
  if(!fragments.length)return;
  if(fragments.length>1)strings.push(fragments.join(''));
  else{
   // The tokenizer's whole-string fast path can itself return an escape rope.
   // Copy UTF-16 code units in small windows, preserving even lone surrogates.
   // Encoding through UTF-8 here would silently replace those code units.
   const value=fragments[0],units=new Uint16Array(Math.min(value.length,4096));
   for(let offset=0;offset<value.length;offset+=units.length){
    const length=Math.min(units.length,value.length-offset);
    for(let i=0;i<length;i++)units[i]=value.charCodeAt(offset+i);
    strings.push(String.fromCharCode(...units.subarray(0,length)));
   }
  }
  fragments=[];
 };
 const accept=result=>{
  for(const token of result===none?[]:isMany(result)?getManyValues(result):[result]){
   // Escaped text can contain a token for every character. Flatten bounded
   // batches so the recovered record does not retain a rope node per escape.
   if(token.name==='startString'){started=true;continue;}
   if(token.name==='stringChunk'){fragments.push(token.value);if(fragments.length===4096)flushString();continue;}
   if(token.name==='endString'){flushString();assembler.consume({name:'stringValue',value:strings.join('')});strings=[];continue;}
   if(token.name==='keyValue'&&Object.hasOwn(assembler.current,token.value))throw new SyntaxError('Duplicate JSON key.');
   started=true;assembler.consume(token);
  }
 };
 const discard=()=>{parser=null;assembler=null;fragments=[];strings=[];};
 return {
  write(text){
   if(!parser)throw new TypeError('JSON decoder is closed.');
   try{if(typeof text!=='string')throw new TypeError('Expected decoded JSON text.');accept(parser(text));}catch(error){discard();throw new SyntaxError('Invalid JSON.',{cause:error});}
  },
  finish(){
   if(!parser)throw new TypeError('JSON decoder is closed.');
   try{accept(parser(none));if(!started||!assembler.done)throw new SyntaxError('Incomplete JSON.');return assembler.current;}
   catch(error){throw new SyntaxError('Invalid JSON.',{cause:error});}finally{discard();}
  },
  discard
 };
}
