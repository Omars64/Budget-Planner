const districts=[
 {name:'Ocean Drive',freq:'88.3',file:'drive',section:'Bank Inbox',action:'Review bank alerts',notes:[220,261.63,329.63,392]},
 {name:'Little Havana',freq:'94.7',file:'havana',section:'Transactions',action:'Review transactions',notes:[196,246.94,293.66,369.99]},
 {name:'Biscayne Bay',freq:'101.9',file:'bay',section:'Debt reminders',action:'Review debt reminders',notes:[174.61,220,261.63,329.63]}];
const account=document.documentElement.dataset.account;
let counts=[null,null,null],systemMotion=true;
function play(){if(!audio)return;let notes=districts[synthIndex].notes,t=audio.currentTime;let pattern=[0,1,2,1,3,2,1,2];function voice(hz,vol,len){let o=audio.createOscillator(),g=audio.createGain();o.type='sine';o.frequency.value=hz;o.connect(g);g.connect(audio.destination);g.gain.setValueAtTime(.0001,t);g.gain.exponentialRampToValueAtTime(Math.max(.0001,vol*synthVolume/100),t+.07);g.gain.exponentialRampToValueAtTime(.0001,t+len);o.start(t);o.stop(t+len+.02)}voice(notes[pattern[beat%8]],.075,.6);if(beat%4===0)voice(notes[0]/2,.085,1);if(counts.every(n=>n===0)&&beat%2===1)voice(notes[(beat+1)%4]*2,.035,.45);beat++}

const $ = id => document.getElementById(id);
const key = 'budgetly.afterhours.v1.'+account;
let storedPreferences
try { storedPreferences=JSON.parse(localStorage.getItem(key)||'{}') } catch { storedPreferences={} }
const state = Object.assign({messages:{}, tracks:{}, globalTrack:'', mode:'continuous', motion:true, volume:60}, storedPreferences);

const defaults = districts.map(d=>['Welcome to '+d.name+'.',d.action+'.','All caught up. Enjoy the music.']);
const labels=['Welcome','Something to review','All caught up'];
let idx=0, editing=0, page='city', playing=false, audio=null, beat=0, timer, generation=0, current=null, currentKey=null, synthIndex=0, synthVolume=60, previewing=false, uploadGeneration=0;
let drafts={}, library=[], retired=new Set();
let database;
const openDatabase=()=>database ||= new Promise((resolve,reject)=>{
 const req=indexedDB.open('budgetly-afterhours-local-audio-'+account,1);
 req.onupgradeneeded=()=>req.result.createObjectStore('tracks',{keyPath:'id'});
 req.onsuccess=()=>resolve(req.result);req.onerror=()=>{database=null;reject(req.error)};
});
async function access(mode,operation){
 const db=await openDatabase();
 return new Promise((resolve,reject)=>{const tx=db.transaction('tracks',mode),req=operation(tx.objectStore('tracks'));tx.oncomplete=()=>resolve(req.result);tx.onabort=()=>reject(tx.error);tx.onerror=()=>reject(tx.error)});
}
function messages(i){return state.messages[i]||defaults[i]}
const nav=document.querySelector('.channels');
districts.forEach((d,i)=>{const b=document.createElement('button');b.className='channel';b.style.setProperty('--img','url('+d.file+'.webp)');b.onclick=()=>{idx=i;draw();if(playing)tune(i)};nav.append(b)});
function draw(){
 const d=districts[idx],m=messages(idx);document.body.classList.toggle('still',!state.motion || !systemMotion);
 document.querySelectorAll('.art').forEach((a,i)=>a.classList.toggle('live',idx===i));
 [...nav.children].forEach((b,i)=>{const x=districts[i];b.innerHTML='<small>'+x.freq+' FM '+(counts[i]===0?'✓':'')+'</small><b>'+x.name+'</b>';b.setAttribute('aria-pressed',i===idx)});
 $('station').textContent='After Hours FM / '+d.freq+' / Miami';$('title').innerHTML=d.name.split(' ').join('<br><em>')+'</em>';$('welcome').textContent=m[0];$('desc').textContent=m[counts[idx]===0?2:1];$('action').textContent=counts[idx]===0?'Revisit '+d.section:d.action;$('count').textContent=(counts[idx]===null?'':(typeof counts[idx]==='number'?counts[idx]+' to review':counts[idx]));$('radio').textContent=playing?'♫ Radio on':'♪ Radio off';
}
function dispose(p){if(!p)return;p.pause();URL.revokeObjectURL(p.src);p.removeAttribute('src');p.load();retired.delete(p)}
function stop(){
 generation++;clearInterval(timer);if(audio){audio.close();audio=null}dispose(current);current=null;for(const p of retired)dispose(p);playing=false;currentKey=null;draw();
}
async function tune(i,id=state.mode==='continuous'?state.globalTrack:state.tracks[i],vol=state.volume){
 const dest=id||'synth-'+i;
 if(currentKey===dest&&playing){if(current)current.volume=vol/100;return}
 const token=++generation;
 try{
 let next=null;
 if(id){const data=await access('readonly',s=>s.get(id));if(token!==generation)return;if(!data)throw Error('Track unavailable. Choose another track.');
 next=new Audio(URL.createObjectURL(data.file));next.loop=true;next.volume=0;try{await next.play()}catch(e){dispose(next);throw e}
 if(token!==generation){dispose(next);return}}
 clearInterval(timer);if(audio){audio.close();audio=null}
 let old=current;current=next;if(old)retired.add(old);
 if(next||old){let start=performance.now(),oldVolume=old?.volume||0;
 function fade(now){if(token!==generation){if(old&&retired.has(old))dispose(old);return}const f=Math.min(1,(now-start)/400);if(next)next.volume=f*vol/100;if(old)old.volume=oldVolume*(1-f);if(f<1)requestAnimationFrame(fade);else dispose(old)}requestAnimationFrame(fade)}
 if(!next){synthIndex=i;synthVolume=vol;beat=0;audio=new AudioContext();await audio.resume();if(token!==generation)return;play();timer=setInterval(play,430)}
 currentKey=dest;playing=true;draw();
 }catch(e){if(token!==generation)return;stop();$('status').textContent='Playback unavailable. Try another audio file.';if(!$('customize').open)$('desc').textContent=$('status').textContent}
}
$('radio').onclick=()=>playing?stop():tune(idx);$('leave').onclick=()=>parent.postMessage({kind:'budgetly-station',destination:'more'},new URL(document.baseURI).origin);
$('action').onclick=()=>parent.postMessage({kind:'budgetly-station',destination:idx},new URL(document.baseURI).origin);
window.addEventListener('message',e=>{if(e.source===parent&&e.origin===new URL(document.baseURI).origin&&e.data?.kind==='budgetly-station-state'){counts=e.data.counts;systemMotion=e.data.motion;draw()}});
function loadFields(){
 $('districtPicker').value=editing;
 $('fields').replaceChildren();
 labels.forEach((label,i)=>{let l=document.createElement('label'),line=document.createElement('span'),input=document.createElement('input'),reset=document.createElement('button');
 line.className='field';input.type='text';input.maxLength=140;input.value=drafts.messages[editing][i];input.setAttribute('aria-label',label);input.oninput=()=>drafts.messages[editing][i]=input.value;reset.textContent='Restore original';reset.type='button';reset.onclick=e=>{e.preventDefault();input.value=defaults[editing][i];input.oninput()};line.append(label,reset);l.append(line,input);$('fields').append(l)});
 $('track').replaceChildren(new Option('Built-in station music',''),...library.map(t=>new Option(t.name,t.id)));$('track').value=drafts.mode==='continuous'?drafts.globalTrack:(drafts.tracks[editing]||'');
}
$('custom').onclick=async()=>{
 stop();editing=idx;drafts=structuredClone(state);districts.forEach((_,i)=>drafts.messages[i]=[...messages(i)]);
 $('mode').value=drafts.mode;$('motion').checked=drafts.motion;$('volume').value=drafts.volume;$('previewCard').hidden=true;$('status').textContent='';$('districtPicker').replaceChildren(...districts.map((d,i)=>new Option(d.name,i)));loadFields();
 try{library=[];const ids=await access('readonly',s=>s.getAllKeys());for(const id of ids){const r=await access('readonly',s=>s.get(id));library.push({id,name:r.name})}loadFields()}catch{$('status').textContent='Audio storage unavailable in this browser.'}if(page==='city' && !$('customize').open)$('customize').showModal()
};
function endPreview(){if(previewing){stop();previewing=false}$('previewCard').hidden=true}
$('districtPicker').onchange=()=>{endPreview();editing=+$('districtPicker').value;loadFields()};
$('mode').onchange=()=>{endPreview();const selected=$('track').value;drafts.mode=$('mode').value;if(drafts.mode==='continuous')drafts.globalTrack=selected;else drafts.tracks[editing]=selected;loadFields()};
$('track').onchange=()=>{endPreview();if(drafts.mode==='continuous')drafts.globalTrack=$('track').value;else drafts.tracks[editing]=$('track').value};
$('upload').onchange=async()=>{
 const f=$('upload').files[0];if(!f)return;const token=++uploadGeneration;
 $('status').textContent='Checking audio…';$('save').disabled=true;
 const test=new Audio(),url=URL.createObjectURL(f);
 try{await new Promise((resolve,reject)=>{let timeout=setTimeout(()=>reject(Error()),12000);test.oncanplay=()=>{clearTimeout(timeout);resolve()};test.onerror=()=>{clearTimeout(timeout);reject(Error())};test.preload='auto';test.src=url});if(token!==uploadGeneration)return;
 const id=crypto.randomUUID();await access('readwrite',s=>s.put({id,name:f.name,file:f}));if(token!==uploadGeneration)return;
 library.push({id,name:f.name});loadFields();$('track').value=id;$('track').onchange();$('status').textContent='Added to this device. Preview or save your choice.';
 }catch{$('status').textContent='Could not play or store this file. Try a playable MP3 or WAV.'}
 finally{test.removeAttribute('src');test.load();URL.revokeObjectURL(url);if(token===uploadGeneration){$('save').disabled=false;$('upload').value=''}}
};
$('preview').onclick=()=>{const card=$('previewCard');card.hidden=false;card.style.backgroundImage='linear-gradient(#16092088,#160920bb),url('+districts[editing].file+'.webp)';card.replaceChildren();for(let i of [0,counts[editing]===0?2:1]){let p=document.createElement('p');p.textContent=drafts.messages[editing][i]||defaults[editing][i];card.append(p)}previewing=true;tune(editing,$('track').value,+$('volume').value)};
$('save').onclick=()=>{for(const i of Object.keys(drafts.messages))drafts.messages[i]=drafts.messages[i].map((s,j)=>s.trim()||defaults[i][j]);const updated={...state,messages:drafts.messages,tracks:drafts.tracks,globalTrack:drafts.globalTrack,mode:drafts.mode,volume:+$('volume').value,motion:$('motion').checked};try{localStorage.setItem(key,JSON.stringify(updated))}catch{$('status').textContent='Could not save on this device. Your changes are still here.';return}Object.assign(state,updated);idx=editing;$('customize').close();draw()};
$('cancel').onclick=()=>$('customize').close();$('customize').onclose=()=>{uploadGeneration++;$('save').disabled=false;$('upload').value='';endPreview()};
document.addEventListener('visibilitychange',()=>{if(document.hidden)stop()});window.addEventListener('pagehide',stop);draw();



