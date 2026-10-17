import {glob} from 'node:fs/promises';
import {parseArgs} from 'node:util';

// Keep option values separate from requested paths. Other Node switches can be
// passed unchanged, using --option=value when they take a value.
const strings=['test-concurrency','test-coverage-branches','test-coverage-exclude','test-coverage-functions','test-coverage-include','test-coverage-lines','test-global-setup','test-isolation','experimental-test-isolation','experimental-test-tag-filter','test-name-pattern','test-random-seed','test-reporter','test-reporter-destination','test-rerun-failures','test-shard','test-skip-pattern','test-timeout','import','require','loader','experimental-loader','conditions'];
const options=Object.fromEntries(strings.map(name=>[name,{type:'string',multiple:true,...(name==='require'?{short:'r'}:{})}]));
export async function nativeTestArguments(args,{cwd=process.cwd()}={}){
 const {positionals}=parseArgs({args,options,strict:false,allowPositionals:true});
 const selected=positionals.length?positionals:['test/*.test.js'];
 for(const selector of selected){
  let found=false;
  for await(const entry of glob(selector,{cwd,exclude:name=>name==='node_modules'})){found=true;break;}
  if(!found)throw Error('No test files match: '+selector);
 }
 return positionals.length?[...args]:[...args,...selected];
}
