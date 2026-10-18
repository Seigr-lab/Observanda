import {unzipSync} from 'fflate';
const notices=['META-INF/LICENSE.txt','META-INF/NOTICE.txt','META-INF/NOTICE-tools.txt','org/xmlresolver/notices/w3c-license.txt','META-INF/LICENSE','META-INF/NOTICE','META-INF/FastDoubleParser-LICENSE','META-INF/FastDoubleParser-ThirdParty-LICENSE','META-INF/Schubfach-LICENSE','META-INF/LICENSE.md','META-INF/NOTICE.md'];
const safe=name=>typeof name==='string'&&name.length<512&&!name.startsWith('/')&&!/[\\:\0]/.test(name)&&name.replace(/\/$/,'').split('/').every(part=>part&&part!=='.'&&part!=='..');
// JAR files are ZIP archives; GNU tar on Linux cannot read them. Only small
// legal/source notices from the checksum-pinned validator are materialized.
export function pdfValidatorNotices(bytes){
 if(!(bytes instanceof Uint8Array)||bytes.byteLength>32*1024*1024)throw Error('Invalid validator archive.');let entries=0,size=0;
 const files=unzipSync(bytes,{filter:entry=>{
  if(++entries>10000||!safe(entry.name))throw Error('Invalid validator archive entry.');
  const selected=!entry.name.endsWith('/')&&(notices.includes(entry.name)||entry.name.startsWith('META-INF/maven/'));
  if(selected&&(!Number.isSafeInteger(entry.originalSize)||entry.originalSize<0||entry.originalSize>1024*1024||(size+=entry.originalSize)>8*1024*1024))throw Error('Validator notices exceed their limit.');
  return selected;
 }});
 for(const name of notices)if(!Object.hasOwn(files,name))throw Error('Missing validator license notice.');return files;
}
