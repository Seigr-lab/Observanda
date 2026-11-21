import {randomUUID} from 'node:crypto';

// Tokens are local rendering capabilities, never accepted from a saved source.
// Their replacement streams are consumed while the output writer hashes bytes.
export class PublicationFragments{
 constructor({replay}={}){this.prefix='<!--observanda-'+randomUUID()+'-';this.parts=new Map();this.replay=replay;this.compiled=null;}
 add(read){const token=this.prefix+this.parts.size+'-->';this.parts.set(token,read);this.compiled=null;return token;}
 compile(html){
  if(this.compiled?.html===html)return this.compiled;
  const segments=[];let at=0,scan=0;
  while((scan=html.indexOf(this.prefix,scan))>=0){
   const end=html.indexOf('-->',scan+this.prefix.length);if(end<0)break;
   const token=html.slice(scan,end+3);
   if(this.parts.has(token)){if(scan>at)segments.push({start:at,end:scan});segments.push({token});at=end+3;}
   scan=end+3;
  }
  if(at<html.length)segments.push({start:at,end:html.length});
  return this.compiled={html,segments};
 }
 async *expand(html,overrides=new Map()){
  for(const part of this.compile(html).segments){
   if(!part.token){yield html.slice(part.start,part.end);continue;}
   const override=overrides.get(part.token),read=this.parts.get(part.token);
   yield* override?override():this.replay?this.replay(part.token,read):read();
  }
 }
}
