import {timestamp,playbackWindow,embedUrl} from './film-playback.mjs';

// Local video bytes never leave this browser. Time offset maps a trimmed file
// back to the original video's timeline; seeking never changes stat approval.
export function createFilmPlayer() {
  const root=document.createElement('section');
  root.className='film-player';
  root.innerHTML=`<h3>Watch and verify</h3><p>Click a stat timestamp to replay with 3 seconds of lead-in. Use the player controls to pause or slow playback, then verify or reject the stat below.</p>
    <div class="button-row"><label>Local video (optional) <input type="file" accept="video/*" data-video-file></label><label>Original-video start of local file (seconds) <input type="number" min="0" step="0.01" value="0" data-video-offset></label><button class="btn" data-youtube>Use YouTube</button></div>
    <p data-playback-status role="status">Choose a timestamp. For the 4:37 sample, set the local-file offset to 277.</p>
    <video controls playsinline hidden style="width:100%;max-height:48vh;background:#000"></video>
    <iframe hidden title="Stat video review" allow="autoplay; fullscreen; picture-in-picture" allowfullscreen style="width:100%;height:42vh;border:0"></iframe>
    <p><a data-external hidden target="_blank" rel="noopener">Open this moment on YouTube if embedded playback is unavailable</a></p>`;
  const video=root.querySelector('video'),frame=root.querySelector('iframe'),status=root.querySelector('[data-playback-status]'),file=root.querySelector('[data-video-file]'),offset=root.querySelector('[data-video-offset]'),external=root.querySelector('[data-external]');
  let objectUrl=null,stopAt=Infinity,videoId=null;
  function stop(){video.pause();frame.removeAttribute('src');frame.hidden=true;}
  function clear(){stop();video.removeAttribute('src');video.load();video.hidden=true;if(objectUrl)URL.revokeObjectURL(objectUrl);objectUrl=null;file.value='';}
  file.onchange=()=>{const selected=file.files[0];if(!selected)return;clear();objectUrl=URL.createObjectURL(selected);video.src=objectUrl;video.hidden=false;status.textContent='Local video selected. Set its original-video offset, then click a stat timestamp.';};
  function loadYouTube(){if(!videoId)return;clear();frame.src=`https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&playsinline=1`;frame.hidden=false;external.href=`https://www.youtube.com/watch?v=${videoId}`;external.hidden=false;status.textContent='Video loaded. Press Play if needed. Add a manual observation or import analysis results to review stats; loading a video does not run AI analysis.';}
  root.querySelector('[data-youtube]').onclick=loadYouTube;
  video.ontimeupdate=()=>{if(video.currentTime>=stopAt)video.pause();};
  video.onerror=()=>{status.textContent='This local video could not be decoded. Choose an MP4 or use YouTube.';};
  async function watch(film,candidate){
    external.href=`https://www.youtube.com/watch?v=${film.videoId}&t=${Math.max(0,Math.floor(candidate.start-3))}s`;external.hidden=false;
    try {
      if(objectUrl){
        if(video.readyState<1)throw Error('Video metadata is still loading. Try the timestamp again.');
        const range=playbackWindow(candidate.start,candidate.end,Number(offset.value),video.duration);
        frame.hidden=true;frame.removeAttribute('src');video.hidden=false;stopAt=range.end;video.currentTime=range.start;
        await video.play();
      }else{video.pause();video.hidden=true;frame.src=embedUrl(film.videoId,candidate.start,candidate.end);frame.hidden=false;}
      status.textContent=`Reviewing ${timestamp(candidate.start)}–${timestamp(candidate.end)} • ${candidate.type?.replaceAll('_',' ')||'Action unclassified'}. Watching does not verify this stat.`;
    }catch(error){status.textContent=error.message;}
    root.scrollIntoView({block:'nearest',behavior:'smooth'});
  }
  return {root,watch,stop,loadYouTube,setVideo(id){if(videoId!==id){clear();offset.value='0';external.hidden=true;status.textContent='Choose a timestamp. For the 4:37 sample, set the local-file offset to 277.';videoId=id;}}};
}
