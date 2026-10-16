export function legacyRecords(book){
  for(const record of book.entries){
    if(record.figures){const f=record.figures[0];record.chart=f?{title:f.title,kind:f.kind,xLabel:f.x.label,yLabel:f.y.label,points:f.series[0].points.map(p=>({label:p.x,value:p.y}))}:null;delete record.figures;}
    record.author=record.contributors.map(person=>person.name).join(', ');
    delete record.contributors;delete record.relations;
  }
  return book;
}
