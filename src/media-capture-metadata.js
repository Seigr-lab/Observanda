// Capture details a camera wrote into an original photograph (EXIF in JPEG or
// TIFF): who made it, its copyright note, when and where it was taken. They
// are read from the retained original and offered to the author, who decides
// what to keep; the original bytes are never changed and nothing is stored
// until the author saves the media details. The parser is bounded: it reads
// only the first EXIF block and refuses offsets outside it.
const MAX_SCAN=256*1024;
const TAGS={artist:0x013b,copyright:0x8298,description:0x010e,dateTime:0x0132,make:0x010f,model:0x0110,exifPointer:0x8769,gpsPointer:0x8825,original:0x9003,offsetOriginal:0x9011,subSecond:0x9291};
const GPS={latitudeRef:1,latitude:2,longitudeRef:3,longitude:4,altitudeRef:5,altitude:6};
const TYPE_SIZES={1:1,2:1,3:2,4:4,5:8,7:1,9:4,10:8};

function tiff(view,start,end){
 const little=view.getUint16(start)===0x4949;if(!little&&view.getUint16(start)!==0x4d4d)return null;
 if(view.getUint16(start+2,little)!==42)return null;
 const u16=at=>view.getUint16(at,little),u32=at=>view.getUint32(at,little),i32=at=>view.getInt32(at,little);
 const inside=(at,size)=>Number.isSafeInteger(at)&&at>=start&&at+size<=end;
 function entries(offset){
  const at=start+offset,result=new Map();if(!inside(at,2))return result;
  const count=u16(at);if(count>512||!inside(at+2,count*12))return result;
  for(let i=0;i<count;i++){
   const entry=at+2+i*12,tag=u16(entry),type=u16(entry+2),length=u32(entry+4),size=(TYPE_SIZES[type]??0)*length;
   if(!size||size>65536)continue;
   const data=size<=4?entry+8:start+u32(entry+8);if(!inside(data,size))continue;
   result.set(tag,{type,length,data});
  }
  return result;
 }
 const text=value=>{if(!value||![1,2,7].includes(value.type))return '';let s='';for(let i=0;i<value.length;i++){const c=view.getUint8(value.data+i);if(!c)break;s+=String.fromCharCode(c);}return s;};
 const utf8=value=>{if(!value||![1,2,7].includes(value.type))return '';const bytes=new Uint8Array(view.buffer,view.byteOffset+value.data,value.length),zero=bytes.indexOf(0);try{return new TextDecoder('utf-8',{fatal:true}).decode(zero<0?bytes:bytes.subarray(0,zero)).trim();}catch{return text(value).trim();}};
 const rationals=value=>{if(!value||![5,10].includes(value.type))return null;const out=[];for(let i=0;i<value.length;i++){const n=value.type===5?u32(value.data+i*8):i32(value.data+i*8),d=value.type===5?u32(value.data+i*8+4):i32(value.data+i*8+4);if(!d)return null;out.push([n,d]);}return out;};
 const pointer=value=>value&&value.type===4&&value.length===1?u32(value.data):null;
 return {first:u32(start+4),entries,text,utf8,rationals,pointer};
}
// Exact decimal degrees from EXIF degree/minute/second rationals, with the
// precision the camera recorded (no float rounding beyond 9 decimals).
function degrees(parts,ref){
 if(!parts||parts.length!==3)return null;
 const value=parts[0][0]/parts[0][1]+parts[1][0]/parts[1][1]/60+parts[2][0]/parts[2][1]/3600;
 if(!Number.isFinite(value))return null;
 return (['S','W'].includes(ref)?'-':'')+String(Number(value.toFixed(9)));
}
const captureDate=value=>{const match=/^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/.exec(value.trim());return match?{date:match[1]+'-'+match[2]+'-'+match[3],time:match[4]+':'+match[5]+':'+match[6]}:null;};

// Returns null when the file carries no readable EXIF block.
export function readCaptureMetadata(bytes){
 const buffer=Buffer.isBuffer(bytes)?bytes:Buffer.from(bytes),length=Math.min(buffer.length,MAX_SCAN),view=new DataView(buffer.buffer,buffer.byteOffset,length);
 let start=-1,end=length;
 if(length>4&&view.getUint16(0)===0xffd8){
  for(let at=2;at+4<=length;){
   if(view.getUint8(at)!==0xff)return null;const marker=view.getUint8(at+1);if(marker===0xd9||marker===0xda)return null;
   const size=view.getUint16(at+2);if(size<2)return null;
   if(marker===0xe1&&at+10<=length&&buffer.toString('latin1',at+4,at+10)==='Exif\0\0'){start=at+10;end=Math.min(length,at+2+size);break;}
   at+=2+size;
  }
 }else if(length>8&&[0x4949,0x4d4d].includes(view.getUint16(0)))start=0;
 if(start<0)return null;
 const reader=tiff(view,start,end);if(!reader)return null;
 const ifd0=reader.entries(reader.first),exifOffset=reader.pointer(ifd0.get(TAGS.exifPointer)),gpsOffset=reader.pointer(ifd0.get(TAGS.gpsPointer));
 const exif=exifOffset===null?new Map():reader.entries(exifOffset),gps=gpsOffset===null?new Map():reader.entries(gpsOffset);
 const taken=captureDate(reader.text(exif.get(TAGS.original))||reader.text(ifd0.get(TAGS.dateTime))),offset=reader.text(exif.get(TAGS.offsetOriginal)).trim(),sub=reader.text(exif.get(TAGS.subSecond)).trim();
 const latitude=degrees(reader.rationals(gps.get(GPS.latitude)),reader.text(gps.get(GPS.latitudeRef)).trim()),longitude=degrees(reader.rationals(gps.get(GPS.longitude)),reader.text(gps.get(GPS.longitudeRef)).trim());
 const altitudeParts=reader.rationals(gps.get(GPS.altitude)),altitudeRef=gps.get(GPS.altitudeRef),altitude=altitudeParts?.length===1?(altitudeRef&&view.getUint8(altitudeRef.data)===1?-1:1)*altitudeParts[0][0]/altitudeParts[0][1]:null;
 const camera=[reader.utf8(ifd0.get(TAGS.make)),reader.utf8(ifd0.get(TAGS.model))].filter(Boolean).join(' ');
 const result={
  creator:reader.utf8(ifd0.get(TAGS.artist)).slice(0,300),
  copyright:reader.utf8(ifd0.get(TAGS.copyright)).slice(0,600),
  description:reader.utf8(ifd0.get(TAGS.description)).slice(0,600),
  camera:camera.slice(0,300),
  capturedOn:taken?.date??'',
  capturedTime:taken?taken.time+(/^\d{1,3}$/.test(sub)?'.'+sub.padEnd(3,'0').slice(0,3):'')+(/^[+-]\d{2}:\d{2}$/.test(offset)?offset:''):'',
  latitude:latitude??'',longitude:longitude??'',altitude:Number.isFinite(altitude)?String(Number(altitude.toFixed(3))):''
 };
 return Object.values(result).some(Boolean)?result:null;
}
