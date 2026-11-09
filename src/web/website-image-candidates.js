// Candidate URLs may contain commas. The HTML grammar consumes the URL up to
// ASCII whitespace, then reads its descriptor up to the next separator.
const space=ch=>ch===' '||ch==='\n'||ch==='\r'||ch==='\t'||ch==='\f';
export function imageCandidates(text){
 const found=[],descriptors=new Set();let at=0,mode;
 while(at<text.length){
  while(space(text[at]))at++;
  if(at===text.length||text[at]===',')return null;
  const start=at;
  while(at<text.length&&!space(text[at]))at++;
  let end=at,descriptor='';
  if(text[end-1]===','){
   end--;if(text[end-1]===','||at===text.length)return null;
  }else{
   while(space(text[at]))at++;
   const descriptorStart=at;
   while(at<text.length&&text[at]!==',')at++;
   descriptor=text.slice(descriptorStart,at).replace(/[\t\r\n\f ]+$/,'');
   if(at<text.length&&++at===text.length)return null;
  }
  const unit=descriptor.endsWith('w')?'w':'x';
  const grammar=unit==='w'?/^\d+w$/:/^(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?x$/;
  const value=descriptor?Number(descriptor.slice(0,-1)):1;
  if(end===start||descriptor&&!grammar.test(descriptor)||!Number.isFinite(value)||value<=0||unit==='w'&&!Number.isSafeInteger(value)||mode&&unit!==mode||descriptors.has(value))return null;
  mode=unit;descriptors.add(value);
  found.push({url:text.slice(start,end),start,end,descriptor});
 }
 return found.length?found:null;
}
export function mapImageCandidates(value,rewrite){
 const candidates=imageCandidates(value);if(!candidates)return value;
 const parts=[];let at=0;
 for(const {url,start,end} of candidates){
  const next=rewrite(url);if(next===url)continue;
  parts.push(value.slice(at,start),next);at=end;
 }
 return parts.length?parts.join('')+value.slice(at):value;
}
export function imageResourceURLs(name,value){
 return name==='srcset'?(imageCandidates(value)??[]).map(c=>c.url):[value];
}
export function displayWidths(width,height){
 const longest=Math.max(width,height);
 return [...new Set([320,640,960,1440].filter(size=>size<longest).map(size=>Math.max(1,Math.round(width*size/longest))))].filter(size=>size<width);
}
