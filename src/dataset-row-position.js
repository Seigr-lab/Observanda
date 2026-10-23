// Immutable page descriptors carry raw and included row ranks. A late filtered
// window seeks the existing sequence index instead of rereading earlier cells.
import {AppError} from './errors.js';
export const DATASET_ROWS_PER_PAGE=64;
const fail=()=>{throw new AppError('MATERIAL_MISSING');};
const uint=value=>Number.isSafeInteger(value)&&value>=0;
export function datasetPageInfo(doc,page,info){
 if(doc.content.datasetFormat!==3)return info;
 const c=doc.content;
 if(!uint(c.rowCount)||c.pageIndex.count!==Math.ceil(c.rowCount/DATASET_ROWS_PER_PAGE)||info.count!==Math.min(DATASET_ROWS_PER_PAGE,c.rowCount-page*DATASET_ROWS_PER_PAGE))fail();
 if(c.includedRowCount!==undefined){
  if(!uint(c.includedRowCount)||c.includedRowCount>c.rowCount||info.start!==page*DATASET_ROWS_PER_PAGE||!uint(info.includedStart)||!uint(info.included)||info.included>info.count||info.includedStart>info.start||info.includedStart+info.included>c.includedRowCount||page===0&&info.includedStart!==0||page===c.pageIndex.count-1&&info.includedStart+info.included!==c.includedRowCount)fail();
 }
 return info;
}
export async function datasetRowPosition(materials,doc,{offset,includeExcluded}){
 if(!uint(offset)||typeof includeExcluded!=='boolean')throw new AppError('INVALID');
 const pages=materials.datasetPageCount(doc),c=doc.content;
 if(c.datasetFormat!==3||!includeExcluded&&c.includedRowCount===undefined)return null;
 if(!uint(c.rowCount)||pages!==Math.ceil(c.rowCount/DATASET_ROWS_PER_PAGE)||c.includedRowCount!==undefined&&(!uint(c.includedRowCount)||c.includedRowCount>c.rowCount))fail();
 const total=includeExcluded?c.rowCount:c.includedRowCount;
 if(offset>=total)return {page:pages,row:0,ordinal:c.rowCount,offset:total};
 if(includeExcluded){const page=Math.floor(offset/DATASET_ROWS_PER_PAGE);datasetPageInfo(doc,page,await materials.sequences.item(c.pageIndex,page));return {page,row:offset%DATASET_ROWS_PER_PAGE,ordinal:offset,offset};}
 let low=0,high=pages;
 while(low<high){const mid=low+Math.floor((high-low)/2),info=datasetPageInfo(doc,mid,await materials.sequences.item(c.pageIndex,mid));if(info.includedStart+info.included<=offset)low=mid+1;else high=mid;}
 if(low>=pages)fail();const info=datasetPageInfo(doc,low,await materials.sequences.item(c.pageIndex,low));if(info.includedStart>offset)fail();
 return {page:low,row:0,ordinal:info.start,offset:info.includedStart};
}
