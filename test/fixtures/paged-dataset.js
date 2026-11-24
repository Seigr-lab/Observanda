import {readPagedDataset} from '../../src/dataset-paged-reader.js';

// Read a whole dataset through the product reader into plain values: the
// header's column names and source mapping, then for each row its order,
// locator and every cell's exact text, value kind and source pointer.
export async function pagedDataset(source,mapping,options={}){
 let header={columns:[],sourceMapping:null};const rows=[];
 for await(const item of readPagedDataset(source,mapping,options)){
  if(!item.cells){header={columns:(await Array.fromAsync(item.columns())).map(column=>column.name),sourceMapping:item.sourceMapping};continue;}
  const cells=[],valueKinds=[],cellPointers=[];
  for await(const value of item.cells()){let text='';for await(const chunk of value.read())text+=chunk;cells.push(text);valueKinds.push(value.kind);cellPointers.push(value.pointer);}
  rows.push({...item,cells,valueKinds,cellPointers});
 }
 return {...header,rows};
}
