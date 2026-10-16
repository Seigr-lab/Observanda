import {test} from 'node:test';
import assert from 'node:assert/strict';
import {publicationEditorProjection} from '../src/publication-editor-projection.js';

test('canvas editor labels whitelist admitted media and omit originals, paths and private metadata',()=>{
 const descriptor={id:'page',sourceWorkspaceId:'source',title:'Chosen page',notebookId:'book',type:'note',media:[{id:'visible'}],attachments:[{id:'visible',kind:'image',caption:'Cover',alt:'Cover description'}],body:'private prose',relations:[{target:'private target'}]};
 const owner={source:{workspaceId:'source'},snapshotId:'snapshot',owner:{projectId:'project',labBookId:'book',root:'private location'},projected:{projects:[{id:'project',title:'Project',description:'Private project detail',privateSettings:'secret'}],notebooks:[{id:'book',title:'Book',projectId:'project',configuration:'private configuration'}]},originals:new Map([['page',{body:'Original prose',attachments:[{id:'visible',kind:'image',caption:'Photo',alt:'Description',transcript:'Private transcript',file:'private file',unknown:'secret'},{id:'hidden',kind:'image',caption:'Excluded image'}]}]])};
 const provider={metadata:{id:'host'},owners:[owner],descriptors:new Map([['page',descriptor],['local',{id:'local',title:'Local page'}]])};
 const projection=publicationEditorProjection(provider);
 assert.deepEqual(projection,{workspaceId:'host',recordCount:0,sources:[{workspaceId:'source',snapshotId:'snapshot',projectId:'project',labBookId:'book'}],projects:[{id:'project',title:'Project',parentId:null,share:true,logoId:null,description:''}],notebooks:[{id:'book',projectId:'project',title:'Book'}],records:[{id:'page',title:'Chosen page',notebookId:'book',type:'note',share:true,attachments:[{id:'visible',kind:'image',caption:'Photo',alt:'Description',share:true}]}]});
 projection.records[0].attachments[0].caption='Website caption';assert.equal(owner.originals.get('page').attachments[0].caption,'Photo');
 owner.originals.clear();assert.equal(publicationEditorProjection(provider).records[0].attachments[0].caption,'Cover');
 descriptor.media=[];assert.deepEqual(publicationEditorProjection(provider).records[0].attachments,[]);
});
