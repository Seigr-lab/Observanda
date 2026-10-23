// A selected page is dense. Saved references still name absolute source columns.
export function datasetColumnPosition(row,index){
 const position=row.columnIndices?row.columnIndices.indexOf(index):index;
 if(!Number.isSafeInteger(position)||position<0||position>=row.cells.length)throw new TypeError('Missing selected dataset column');
 return position;
}
export const datasetCell=(row,index)=>row.cells[datasetColumnPosition(row,index)];
