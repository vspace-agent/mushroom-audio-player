// Provide original FLAC downloads and browser-side WAV/MP3 conversions without modifying the archive.
function makeDownloadControls(track){
  const panel=document.createElement('div');
  panel.className='download-controls';
  const message=document.createElement('span');
  message.className='download-status';
  message.setAttribute('role','status');
  const buttons=[];
  const filename=track.filename||track.id.split('/').pop();
  function button(label,handler){
    const node=document.createElement('button');
    node.type='button';node.textContent='↓ '+label;
    node.onclick=async()=>{
      buttons.forEach(b=>b.disabled=true);
      message.textContent='Preparing '+label+'…';
      try{await handler();message.textContent=label+' ready';}
      catch(error){message.textContent='Download failed: '+error.message;}
      finally{buttons.forEach(b=>b.disabled=false);}
    };
    buttons.push(node);panel.append(node);
  }
  function saveBlob(blob,extension){
    const url=URL.createObjectURL(blob);
    const link=document.createElement('a');
    link.href=url;link.download=filename+'.'+extension;
    document.body.append(link);link.click();link.remove();
    setTimeout(()=>URL.revokeObjectURL(url),60000);
  }
  async function decode(){
    const response=await fetch(track.src);
    if(!response.ok)throw Error('Audio HTTP '+response.status);
    const context=new (window.AudioContext||window.webkitAudioContext)();
    try{return await context.decodeAudioData(await response.arrayBuffer());}
    finally{await context.close();}
  }
  function encodeWav(audio){
    const channels=audio.numberOfChannels,frames=audio.length,rate=audio.sampleRate;
    const buffer=new ArrayBuffer(44+frames*channels*2),view=new DataView(buffer);
    function ascii(offset,text){for(let i=0;i<text.length;i++)view.setUint8(offset+i,text.charCodeAt(i));}
    ascii(0,'RIFF');view.setUint32(4,buffer.byteLength-8,true);
    ascii(8,'WAVE');ascii(12,'fmt ');view.setUint32(16,16,true);
    view.setUint16(20,1,true);view.setUint16(22,channels,true);
    view.setUint32(24,rate,true);view.setUint32(28,rate*channels*2,true);
    view.setUint16(32,channels*2,true);view.setUint16(34,16,true);
    ascii(36,'data');view.setUint32(40,frames*channels*2,true);
    const sources=Array.from({length:channels},(_,i)=>audio.getChannelData(i));
    let offset=44;
    for(let frame=0;frame<frames;frame++){
      for(const source of sources){
        const sample=Math.max(-1,Math.min(1,source[frame]));
        view.setInt16(offset,sample<0?Math.round(sample*32768):Math.round(sample*32767),true);
        offset+=2;
      }
    }
    return new Blob([buffer],{type:'audio/wav'});
  }
  const options = Array.isArray(track.downloads) ? track.downloads : [];
  for (const option of options) {
    if (!option || !option.format || !option.url) continue;
    const format = String(option.format).toLowerCase();
    button(format.toUpperCase(), async () => {
      const response = await fetch(new URL(option.url, track._catalogURL || window.audioCatalogURL || document.baseURI));
      if (!response.ok) throw Error('Audio HTTP ' + response.status);
      saveBlob(await response.blob(), format);
    });
  }
  if (track.audio && ['flac','wav','mp3'].includes(String(track.audio.format).toLowerCase())) {
    button('WAV (convert)', async () => saveBlob(encodeWav(await decode()), 'wav'));
  }
  /* MP3 conversion requires a verified bundled encoder.
  button('MP3',async()=>{
    if(typeof lamejs==='undefined')throw Error('MP3 encoder unavailable');
    const audio=await decode();
    const rate=audio.sampleRate,channels=Math.min(2,audio.numberOfChannels);
    const encoder=new lamejs.Mp3Encoder(channels,rate,192);
    const left=audio.getChannelData(0),right=channels===2?audio.getChannelData(1):null;
    const chunks=[];
    const block=1152;
    function pcm(source,start,end){
      const result=new Int16Array(end-start);
      for(let i=start;i<end;i++){
        const value=Math.max(-1,Math.min(1,source[i]));
        result[i-start]=value<0?Math.round(value*32768):Math.round(value*32767);
      }
      return result;
    }
    for(let i=0;i<audio.length;i+=block){
      const end=Math.min(audio.length,i+block);
      const encoded=channels===2
        ?encoder.encodeBuffer(pcm(left,i,end),pcm(right,i,end))
        :encoder.encodeBuffer(pcm(left,i,end));
      if(encoded.length)chunks.push(encoded);
    }
    const tail=encoder.flush();if(tail.length)chunks.push(tail);
    saveBlob(new Blob(chunks,{type:'audio/mpeg'}),'mp3');
  });
  */
  panel.append(message);
  return panel;
}
