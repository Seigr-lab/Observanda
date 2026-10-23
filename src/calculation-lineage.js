// Immutable leaf sets share authenticated branches; unions never flatten source arrays.
import {AppError} from './errors.js';
import {validGraphAddress,graphPosition} from './web/dataset-calculation-graph-model.js';
const fail=()=>{throw new AppError('MATERIAL_MISSING');};
const leafKey=leaf=>'binding:'+String(leaf.binding.position).padStart(16,'0')+':column:'+String(leaf.column).padStart(16,'0')+(leaf.relativeRow===-1?':row:-1':'');
export const validLineageLeaf=leaf=>leaf&&(Object.keys(leaf).sort().join()==='binding,column'||Object.keys(leaf).sort().join()==='binding,column,relativeRow'&&leaf.relativeRow===-1)&&validGraphAddress(leaf.binding)&&graphPosition(leaf.column);
export class CalculationLineage{
 constructor(sequences,write=fn=>fn()){this.sequences=sequences;this.write=write;}
 ref(root=null){return this.sequences.validate({format:1,kind:'calculation-lineage',root,count:root?.count??0,chunkSize:1});}
 async leaf(value){if(!validLineageLeaf(value))fail();let root;await this.write(async()=>{const key=leafKey(value),revision=await this.sequences.put('chunks',{kind:'calculation-lineage',key,items:[value]}),tree=this.sequences.tree();root=await tree.change(null,key,revision);await tree.flush(root);});return this.ref(root);}
 async union(a,b){this.sequences.validate(a);this.sequences.validate(b);if(a.kind!=='calculation-lineage'||b.kind!=='calculation-lineage')fail();if(a.root?.hash===b.root?.hash)return a;if(a.count<b.count)[a,b]=[b,a];let root=a.root;const source=this.sequences.tree(),target=this.sequences.tree();for await(const entry of source.entries({root:b.root})){const prior=await target.find({root},entry.id);if(prior){if(prior.revision!==entry.revision)fail();continue;}await this.write(async()=>{root=await target.change(root,entry.id,entry.revision);await target.flush(root);});}return this.ref(root);}
 async page(ref,options){const page=await this.sequences.page(ref,options);if(ref.kind!=='calculation-lineage'||page.items.some(item=>!validLineageLeaf(item)))fail();return page;}
 async verify(ref){this.sequences.validate(ref);if(ref.kind!=='calculation-lineage')fail();const tree=this.sequences.tree();let count=0;for await(const entry of tree.entries({root:ref.root})){const chunk=await this.sequences.read('chunks',entry.revision);if(chunk?.kind!=='calculation-lineage'||chunk.key!==entry.id||chunk.items?.length!==1||!validLineageLeaf(chunk.items[0])||leafKey(chunk.items[0])!==entry.id)fail();count++;}if(count!==ref.count)fail();}
}
