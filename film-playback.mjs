export function timestamp(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) throw Error('Invalid video timestamp.');
  const whole = Math.floor(seconds);
  const h = Math.floor(whole / 3600), m = Math.floor(whole / 60) % 60, s = whole % 60;
  return `${h ? h + ':' : ''}${h ? String(m).padStart(2, '0') : m}:${String(s).padStart(2, '0')}`;
}
export function playbackWindow(start, end, offset = 0, duration = Infinity) {
  if (![start,end,offset].every(Number.isFinite) || start < 0 || end < start || offset < 0 || !(duration > 0)) throw Error('Invalid playback range.');
  if (start < offset || start - offset >= duration) throw Error('This stat is outside the selected local video. Check its start offset.');
  return {start:Math.max(0,start-offset-3), end:Math.min(duration,end-offset+2)};
}
export function embedUrl(videoId, start, end) {
  if (!/^[\w-]{11}$/.test(videoId)) throw Error('Invalid video ID.');
  const range=playbackWindow(start,end);
  return `https://www.youtube-nocookie.com/embed/${videoId}?start=${Math.floor(range.start)}&end=${Math.max(Math.floor(range.start)+1,Math.ceil(range.end))}&autoplay=1&playsinline=1`;
}

export function youtubeId(value) {
  const raw=String(value||'').trim();
  if(/^[\w-]{11}$/.test(raw))return raw;
  let url;try{url=new URL(raw);}catch{throw Error('Paste a valid YouTube video URL.');}
  if(!['https:','http:'].includes(url.protocol))throw Error('Paste a valid YouTube video URL.');
  const host=url.hostname.toLowerCase(),parts=url.pathname.split('/').filter(Boolean);
  const id=host==='youtu.be'?parts[0]:['youtube.com','www.youtube.com','m.youtube.com'].includes(host)?(url.pathname==='/watch'?url.searchParams.get('v'):['live','shorts','embed'].includes(parts[0])?parts[1]:null):null;
  if(!/^[\w-]{11}$/.test(id||''))throw Error('Paste a valid YouTube video URL.');
  return id;
}
