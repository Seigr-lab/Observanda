import {AppError} from './errors.js';
import {normalizePrivateText,privateTextPatterns} from './privacy-text.js';
import {PrivacyPatternStream,PrivacyBlockedStream} from './privacy-pattern-stream.js';

export const PRIVACY_NORMALIZATION_SEGMENT=64*1024;
const INPUT_CHUNK=16*1024,BASE64_LIMIT=200000;
const strip=value=>value.replace(/[\u200b-\u200f\ufeff]/g,'');
// Normalization boundaries follow Unicode UAX #15 (unicode.org/reports/tr15/).
// A decomposed non-mark starter cannot reorder across this boundary. Hangul
// medial/final jamo can compose backwards and therefore remain in the suffix.
const boundary=char=>{if(char.charCodeAt(0)<128)return true;const first=[...char.normalize('NFKD')][0],cp=first.codePointAt(0);return !/\p{M}/u.test(first)&&!(cp>=0x1161&&cp<=0x1175||cp>=0x11a8&&cp<=0x11c2);};
class Normalization{
 constructor(emit,stats){this.emit=emit;this.stats=stats;this.pending='';}
 push(text){
  let last=-1,units=0,segment=this.pending.length;
  for(const char of text){
   if(boundary(char)){last=units;segment=0;}units+=char.length;segment+=char.length;
   if(segment>PRIVACY_NORMALIZATION_SEGMENT)throw new AppError('PRIVACY_TEXT_COMPLEXITY');
   if(this.stats)this.stats.maximumNormalizationUnits=Math.max(this.stats.maximumNormalizationUnits??0,segment);
  }
  if(last<0){this.pending+=text;return;}
  const complete=this.pending+text.slice(0,last);this.pending=text.slice(last);
  if(complete)this.emit(strip(complete.normalize('NFKC')));
 }
 finish(){this.emit(strip(this.pending.normalize('NFKC')));this.pending='';}
}
class FixedReplacement{
 constructor(pattern,replace,width){this.pattern=pattern;this.replace=replace;this.width=width;this.pending='';}
 push(text,final=false){
  text=this.pending+text;let end=final?text.length:Math.max(0,text.length-this.width+1);this.pattern.lastIndex=0;let match;
  while((match=this.pattern.exec(text))&&match.index<end)end=Math.max(end,match.index+match[0].length);
  const value=text.slice(0,end).replace(this.pattern,this.replace);this.pending=text.slice(end);return value;
 }
}
class NumericEntities{
 constructor(){this.pending='';this.digits=false;this.base=10;this.value=0;}
 push(text,final=false){
  const out=[];let i=0;
  while(i<text.length){
   if(!this.pending){const next=text.indexOf('&',i);if(next<0){out.push(text.slice(i));i=text.length;break;}out.push(text.slice(i,next));this.pending='&';i=next+1;continue;}
   const char=text[i];
   if(this.pending==='&'){if(char==='#'){this.pending='&#';i++;continue;}out.push('&');this.pending='';continue;}
   if(this.pending==='&#'&&!this.digits&&(char==='x'||char==='X')){this.pending='&#'+char;this.base=16;i++;continue;}
   const digit=parseInt(char,this.base),valid=this.base===16?/[0-9a-f]/i.test(char):/[0-9]/.test(char);
   if(valid){this.digits=true;this.value=Math.min(0x110000,this.value*this.base+digit);i++;continue;}
   out.push(this.digits?(this.value<=0x10ffff?String.fromCodePoint(this.value):''):this.pending);
   const consume=this.digits&&char===';';this.pending='';this.digits=false;this.base=10;this.value=0;if(consume)i++;
  }
  if(final&&this.pending){out.push(this.digits?(this.value<=0x10ffff?String.fromCodePoint(this.value):''):this.pending);this.pending='';this.digits=false;this.value=0;this.base=10;}
  return out.join('');
 }
}
class PercentDecoding{
 constructor(strict=false){this.strict=strict;this.valid=true;this.pending='';this.remaining=0;this.point=0;this.minimum=0;this.maximum=0;}
 invalid(){this.valid=false;this.remaining=0;if(this.strict)throw new AppError('UNSAFE');}
 byte(value,out){
  if(!this.strict)out.push(String.fromCharCode(value));
  if(this.remaining){
   if(value<this.minimum||value>this.maximum){this.invalid();return;}
   this.point=(this.point<<6)|(value&63);this.remaining--;this.minimum=0x80;this.maximum=0xbf;
   if(!this.remaining&&this.strict)out.push(String.fromCodePoint(this.point));return;
  }
  if(value<0x80){if(this.strict)out.push(String.fromCharCode(value));return;}
  if(value>=0xc2&&value<=0xdf){this.remaining=1;this.point=value&31;this.minimum=0x80;this.maximum=0xbf;return;}
  if(value>=0xe0&&value<=0xef){this.remaining=2;this.point=value&15;this.minimum=value===0xe0?0xa0:0x80;this.maximum=value===0xed?0x9f:0xbf;return;}
  if(value>=0xf0&&value<=0xf4){this.remaining=3;this.point=value&7;this.minimum=value===0xf0?0x90:0x80;this.maximum=value===0xf4?0x8f:0xbf;return;}
  this.invalid();
 }
 push(text,final=false){
  text=this.pending+text;this.pending='';const out=[];let i=0;
  while(i<text.length){
   const next=text.indexOf('%',i);
   if(next!==i){if(this.remaining)this.invalid();const end=next<0?text.length:next;out.push(text.slice(i,end));i=end;if(next<0)break;}
   if(text.length-i<3&&!final){this.pending=text.slice(i);break;}
   const code=text.slice(i+1,i+3);
   if(code.length===2&&/^[0-9a-f]{2}$/i.test(code)){this.byte(parseInt(code,16),out);i+=3;}
   else{this.invalid();out.push('%');i++;}
  }
  if(final&&this.remaining)this.invalid();return out.join('');
 }
}
function round(strict){return [new FixedReplacement(/\\u([0-9a-f]{4})/gi,(_,hex)=>String.fromCharCode(parseInt(hex,16)),6),new FixedReplacement(/\\x([0-9a-f]{2})/gi,(_,hex)=>String.fromCharCode(parseInt(hex,16)),4),new NumericEntities(),new FixedReplacement(/&(?:colon|sol|bsol|amp);/gi,entity=>({'&colon;':':','&sol;':'/','&bsol;':'\\','&amp;':'&'})[entity.toLowerCase()],7),new FixedReplacement(/\\\//g,'/',2),new PercentDecoding(strict)];}
function pipeline(modes,emit,stats){
 const rounds=modes.map(round),stages=rounds.flat();
 const send=(text,start=0)=>{for(let i=start;i<stages.length;i++)text=stages[i].push(text);if(text)emit(text);};
 const normal=new Normalization(send,stats);
 return {push:text=>normal.push(text),finish(){normal.finish();for(let i=0;i<stages.length;i++)send(stages[i].push('',true),i+1);},modes:()=>rounds.map(parts=>parts.at(-1).valid)};
}
class Base64Candidates{
 constructor(blocked,stats){this.blocked=blocked;this.stats=stats;this.pending='';this.padding=0;this.found=false;}
 candidate(){
  if(this.pending.length>BASE64_LIMIT){this.found=true;this.pending='';this.padding=0;return;}
  if(this.pending.length-this.padding>=24){const value=normalizePrivateText(Buffer.from(this.pending,'base64').toString('utf8'));this.found ||=privateTextPatterns.some(pattern=>pattern.test(value))||this.blocked.some(blocked=>value.toLowerCase().includes(blocked));}
  this.pending='';this.padding=0;
 }
 push(text){
  let i=0;
  while(i<text.length&&!this.found){
   const char=text[i];
   if(/[A-Za-z0-9+/_-]/.test(char)){
    if(this.padding)this.candidate();
    const match=/^[A-Za-z0-9+/_-]+/.exec(text.slice(i))[0];this.pending+=match;i+=match.length;
    if(this.pending.length>BASE64_LIMIT){this.found=true;break;}
   }else if(char==='='&&this.pending&&!this.padding){this.pending+=char;this.padding=1;i++;}
   else if(char==='='&&this.padding===1){this.pending+=char;this.padding=2;i++;this.candidate();}
   else{this.candidate();i++;}
   if(this.pending.length>BASE64_LIMIT)this.found=true;
   if(this.stats)this.stats.maximumBase64Units=Math.max(this.stats.maximumBase64Units??0,Math.min(this.pending.length,BASE64_LIMIT+INPUT_CHUNK));
  }
 }
 finish(){this.candidate();return this.found;}
}
async function textPass(source,consume,{signal}={}){
 const decoder=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true});
 try{
  for await(const bytes of source()){
   signal?.throwIfAborted();
   for(let at=0;at<bytes.length;at+=INPUT_CHUNK){signal?.throwIfAborted();consume(decoder.decode(bytes.subarray(at,at+INPUT_CHUNK),{stream:true}));}
  }
  consume(decoder.decode());signal?.throwIfAborted();
 }catch(error){if(error instanceof TypeError&&error.code==='ERR_ENCODING_INVALID_ENCODED_DATA')throw new AppError('UNSAFE');throw error;}
}
// The source must be replayable and authenticate the same bytes on each pass.
// URI fallback is a whole-string choice. Its ASCII escape recognition is
// unchanged by strict UTF-8 versus byte decoding, so all four decisions can be
// validated together before a second scan performs exact detection.
export async function hasPrivateTextStream(source,blockedValues=[],{signal,stats}={}){
 const blocked=blockedValues.filter(value=>value.length>=4).map(value=>normalizePrivateText(value).toLowerCase());
 const base64=new Base64Candidates(blocked,stats),validation=pipeline([false,false,false,false],()=>{},stats);
 await textPass(source,text=>{base64.push(text);validation.push(text);},{signal});validation.finish();if(base64.finish())return true;
 const patterns=new PrivacyPatternStream({stats}),values=new PrivacyBlockedStream(blocked),detection=pipeline(validation.modes(),text=>{patterns.push(text);values.push(text);},stats);
 await textPass(source,text=>detection.push(text),{signal});detection.finish();return patterns.finish()||values.finish();
}
