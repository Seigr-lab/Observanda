import test from 'node:test';
import assert from 'node:assert/strict';
import {zipSync,strToU8,strFromU8} from 'fflate';
import {pdfValidatorNotices} from '../scripts/pdf-validation-notices.js';
const legal=['LICENSE.txt','NOTICE.txt','NOTICE-tools.txt','LICENSE','NOTICE','FastDoubleParser-LICENSE','FastDoubleParser-ThirdParty-LICENSE','Schubfach-LICENSE','LICENSE.md','NOTICE.md'];
function archive(extra={}){return zipSync({...Object.fromEntries(legal.map(name=>['META-INF/'+name,strToU8('Retained license '+name)])),'org/xmlresolver/notices/w3c-license.txt':strToU8('Retained W3C terms'),'META-INF/maven/org.example/component/pom.properties':strToU8('groupId=org.example\nartifactId=component\nversion=1.0'),'org/example/Main.class':strToU8('Unrelated executable bytes'),...extra});}
test('validator notices are extracted without platform archive tools or executable members',()=>{
 const files=pdfValidatorNotices(archive());assert.equal(Object.keys(files).length,12);assert.equal(strFromU8(files['META-INF/LICENSE.txt']),'Retained license LICENSE.txt');assert.equal(strFromU8(files['META-INF/maven/org.example/component/pom.properties']),'groupId=org.example\nartifactId=component\nversion=1.0');assert.equal(files['org/example/Main.class'],undefined);
});
test('validator notices refuse unsafe archive paths, missing licenses and oversized source metadata',()=>{
 for(const name of ['../escape','META-INF/maven/../../escape','/absolute','C:/escape','META-INF\\escape'])assert.throws(()=>pdfValidatorNotices(archive({[name]:strToU8('unsafe')})));
 assert.throws(()=>pdfValidatorNotices(zipSync({'META-INF/LICENSE.txt':strToU8('incomplete')})),/Missing validator license/);
 assert.throws(()=>pdfValidatorNotices(archive({'META-INF/maven/org.example/oversize':new Uint8Array(1024*1024+1)})),/limit/);
});
