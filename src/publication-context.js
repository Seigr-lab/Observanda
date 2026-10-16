// Internal page admission is process-local. A serialized design context cannot
// opt into the public-edition renderer by adding a flag to its JSON.
const pages=new WeakMap();
export function admitPublicationPage(context,target){pages.set(context,target);return context;}
export const publicationPageTarget=context=>pages.get(context)??null;
