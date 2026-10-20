// Keep structure-changing commands separate from typing until their result is adopted.
// The checkpoint retry control stays available outside these editing surfaces.
export function websiteEditingGuard(doc,busy){
 for(const node of doc.querySelectorAll('.website-controls,.website-preview-tools,#website-draft-preview,.website-site-context'))node.inert=busy;
 const body=doc.querySelector('#website-draft-preview')?.contentDocument?.body;if(body)body.inert=busy;
}
