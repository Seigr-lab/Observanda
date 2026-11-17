import {mediaCommand} from '../src/media.js';
// Media tests run only where the FFmpeg tools the product uses can start.
export async function mediaToolsAvailable(){
 try{await mediaCommand('ffmpeg',['-version']);await mediaCommand('ffprobe',['-version']);return true;}
 catch{return false;}
}
