// Design tokens do not change which records a cursor admits. Keep every
// content/selection field in its binding while allowing a theme edit to retain
// the current reading position in the same pinned research and website source.
export function appearanceCursorMetadata(metadata){
 const {appearance,themes,...content}=metadata;
 return content;
}
