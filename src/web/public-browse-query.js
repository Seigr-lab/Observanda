// Shared by retained preview queries and the self-contained public script.
// Search only the text actually exposed by a public browse row, never private
// query text or the original record body. Keep this predicate self-contained.
export function matchesPublicRecord(row,values){
 const fold=value=>value.toLocaleLowerCase('en');
 return !(values.from&&values.to&&values.from>values.to)&&
  (!values.q||fold(row.text).includes(fold(values.q)))&&
  (!values.tag||row.tags.some(tag=>fold(tag)===fold(values.tag)))&&
  (!values.journey||row.journey===values.journey)&&(!values.type||row.type===values.type)&&
  (!(values.from||values.to)||row.start&&(!values.from||row.end>=values.from)&&(!values.to||row.start<=values.to));
}
