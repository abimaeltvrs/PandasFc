import { initializeApp } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-app.js";
import {
  getFirestore, collection, doc, setDoc, deleteDoc, onSnapshot,
  getDocs, serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.2.1/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyBDRttCbeYSrFttoGPKmgVRrG251ns0Pck",
  authDomain: "panda-fc-449f7.firebaseapp.com",
  projectId: "panda-fc-449f7",
  storageBucket: "panda-fc-449f7.firebasestorage.app",
  messagingSenderId: "854268170585",
  appId: "1:854268170585:web:1f1cadb971677f59a97c48",
  measurementId: "G-GF5664G8HQ"
};

const firebaseApp = initializeApp(firebaseConfig);
const db = getFirestore(firebaseApp);

const state = {
  players: [],
  events: [],
  teamLogo: "",
  selectedLineup: [],
  dashboardMedia: {
    type: "",
    data: "",
    url: "",
    urlMode: "auto"
  }
};

let firebaseReady = false;
const syncStatus = document.getElementById("syncStatus");
function setSyncStatus(text, type=""){
  if(!syncStatus) return;
  syncStatus.textContent = text;
  syncStatus.className = `sync-status ${type}`.trim();
}

function uid(){ return Date.now().toString(36) + Math.random().toString(36).slice(2,7); }
function toast(msg){ const t=document.getElementById('toast'); t.textContent=msg; t.classList.add('show'); setTimeout(()=>t.classList.remove('show'),2200); }
function esc(s=''){ return String(s).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }

function fileToCompressedDataURL(file, maxSize=500, quality=.72){
  return new Promise((resolve,reject)=>{
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => {
      const img = new Image();
      img.onerror = reject;
      img.onload = () => {
        const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img,0,0,canvas.width,canvas.height);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

function fileToDataURL(file){
  return new Promise((resolve,reject)=>{
    const reader=new FileReader();
    reader.onload=()=>resolve(reader.result);
    reader.onerror=reject;
    reader.readAsDataURL(file);
  });
}

function markWriting(){
  setSyncStatus("☁️ Sincronizando...");
}

function connectRealtime(){
  onSnapshot(collection(db,"players"), snap=>{
    state.players = snap.docs.map(d=>({id:d.id,...d.data()}));
    state.players.sort((a,b)=>(Number(a.number)||0)-(Number(b.number)||0) || String(a.name||"").localeCompare(String(b.name||"")));
    firebaseReady = true;
    setSyncStatus("☁️ Sincronizado","ok");
    renderPlayers(); renderLineup(); renderScorers();
  }, err=>syncError(err));

  onSnapshot(collection(db,"events"), snap=>{
    state.events = snap.docs.map(d=>({id:d.id,...d.data()}));
    firebaseReady = true;
    setSyncStatus("☁️ Sincronizado","ok");
    renderEvents(); renderMatches(); renderStats(); renderCalendar(); checkTodayMatches();
  }, err=>syncError(err));

  onSnapshot(doc(db,"settings","team"), snap=>{
    state.teamLogo = snap.exists() ? (snap.data().teamLogo || "") : "";
    firebaseReady = true;
    setSyncStatus("☁️ Sincronizado","ok");
    renderLogo();
  }, err=>syncError(err));

  onSnapshot(doc(db,"settings","dashboard"), snap=>{
    const d = snap.exists() ? snap.data() : {};
    state.dashboardMedia = {
      type: d.mediaType || "",
      data: d.mediaData || "",
      url: d.mediaUrl || "",
      urlMode: d.urlMode || "auto"
    };
    const typeSelect=document.getElementById("dashboardMediaUrlType");
    const urlInput=document.getElementById("dashboardMediaUrl");
    if(typeSelect) typeSelect.value=state.dashboardMedia.urlMode;
    if(urlInput && state.dashboardMedia.url) urlInput.value=state.dashboardMedia.url;
    firebaseReady = true;
    setSyncStatus("☁️ Sincronizado","ok");
    renderDashboardMedia();
  }, err=>syncError(err));

  onSnapshot(doc(db,"lineup","current"), snap=>{
    state.selectedLineup = snap.exists() ? (snap.data().playerIds || []) : [];
    firebaseReady = true;
    setSyncStatus("☁️ Sincronizado","ok");
    renderLineup();
  }, err=>syncError(err));
}

function syncError(err){
  console.error(err);
  setSyncStatus("⚠️ Erro de sincronização","err");
  toast("Erro ao acessar o Firebase. Verifique as regras do Firestore.");
}

document.querySelectorAll('.nav-btn').forEach(btn=>btn.addEventListener('click',()=>{
  document.querySelectorAll('.nav-btn').forEach(b=>b.classList.remove('active'));
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById(btn.dataset.page).classList.add('active');
}));

const playerForm = document.getElementById('playerForm');
playerForm.addEventListener('submit', async e=>{
  e.preventDefault();
  const id=document.getElementById('playerId').value || uid();
  const old=state.players.find(p=>p.id===id);
  const obj={
    name:document.getElementById('playerName').value.trim(),
    position:document.getElementById('playerPosition').value,
    number:Number(document.getElementById('playerNumber').value),
    goals:Number(old?.goals||0),
    updatedAt:serverTimestamp()
  };
  try{
    markWriting();
    await setDoc(doc(db,"players",id),obj,{merge:true});
    playerForm.reset(); document.getElementById('playerId').value='';
    toast('Jogador salvo e sincronizado.');
  }catch(err){ syncError(err); }
});
document.getElementById('cancelPlayerEdit').onclick=()=>{playerForm.reset();document.getElementById('playerId').value='';};
document.getElementById('playerSearch').addEventListener('input',renderPlayers);

function editPlayer(id){
  const p=state.players.find(x=>x.id===id); if(!p)return;
  document.getElementById('playerId').value=p.id; document.getElementById('playerName').value=p.name||'';
  document.getElementById('playerPosition').value=p.position||''; document.getElementById('playerNumber').value=p.number??'';
  document.querySelector('[data-page="cadastro"]').click();
}
async function deletePlayer(id){
  if(!confirm('Excluir este jogador em todos os dispositivos?'))return;
  try{
    markWriting();
    await deleteDoc(doc(db,"players",id));
    const ids=state.selectedLineup.filter(x=>x!==id);
    await setDoc(doc(db,"lineup","current"),{playerIds:ids,updatedAt:serverTimestamp()},{merge:true});
  }catch(err){syncError(err);}
}
function renderPlayers(){
  const q=document.getElementById('playerSearch').value.toLowerCase();
  const arr=state.players.filter(p=>`${p.name} ${p.position} ${p.number}`.toLowerCase().includes(q));
  document.getElementById('playersList').innerHTML=arr.length?arr.map(p=>`
    <div class="list-row">
      <div><strong>#${p.number} ${esc(p.name)}</strong><div class="muted">${esc(p.position)}</div></div>
      <div class="actions"><button onclick="editPlayer('${p.id}')">✏️ Editar</button><button onclick="deletePlayer('${p.id}')">🗑️ Excluir</button></div>
    </div>`).join(''):'<p class="muted">Nenhum jogador cadastrado.</p>';
}

function renderLineup(){
  document.getElementById('lineupPlayers').innerHTML=state.players.length?state.players.map(p=>`
    <label class="check-item"><input type="checkbox" ${state.selectedLineup.includes(p.id)?'checked':''} onchange="toggleLineup('${p.id}',this.checked)">
    <span><strong>#${p.number} ${esc(p.name)}</strong><br><span class="muted">${esc(p.position)}</span></span></label>`).join(''):'<p class="muted">Cadastre jogadores primeiro.</p>';
  renderField();
}
async function toggleLineup(id,on){
  let ids=[...state.selectedLineup];
  if(on&&!ids.includes(id))ids.push(id);
  if(!on)ids=ids.filter(x=>x!==id);
  try{
    markWriting();
    await setDoc(doc(db,"lineup","current"),{playerIds:ids,updatedAt:serverTimestamp()},{merge:true});
  }catch(err){syncError(err);}
}

const positionSlots={
 'Goleiro':[[50,91],[50,9]],
 'Zagueiro':[[30,77],[50,80],[70,77],[35,23],[65,23]],
 'Lateral':[[12,70],[88,70],[12,30],[88,30]],
 'Volante':[[38,62],[62,62],[38,38],[62,38]],
 'Meio-campo':[[25,52],[50,54],[75,52],[50,46]],
 'Atacante':[[30,24],[50,19],[70,24],[30,76],[70,76]]
};
function getPlayerSlots(players){
  const used={}; return players.map((p,idx)=>{
    const slots=positionSlots[p.position]||[[20+((idx*17)%60),50]];
    used[p.position]=(used[p.position]||0);
    const pos=slots[used[p.position]%slots.length]; used[p.position]++;
    return {p,x:pos[0],y:pos[1]};
  });
}
function renderField(){
  const players=state.selectedLineup.map(id=>state.players.find(p=>p.id===id)).filter(Boolean);
  const slots=getPlayerSlots(players);
  document.getElementById('fieldPlayers').innerHTML=slots.map(({p,x,y})=>`<div class="field-player" style="left:${x}%;top:${y}%">#${p.number}<br>${esc(p.name)}</div>`).join('');
}

document.getElementById('downloadLineup').onclick=()=>downloadLineupImage();
async function downloadLineupImage(){
  const c=document.createElement('canvas');
  c.width=1024;
  c.height=1536;
  const x=c.getContext('2d');

  // Fundo preto de segurança
  x.fillStyle='#000';
  x.fillRect(0,0,c.width,c.height);

  // Usa a mesma arte personalizada da aba Escalação
  try{
    const fieldImg=await loadImage('./campo-pandas-fc.png');

    const scale=Math.max(c.width/fieldImg.width,c.height/fieldImg.height);
    const w=fieldImg.width*scale;
    const h=fieldImg.height*scale;
    const dx=(c.width-w)/2;
    const dy=(c.height-h)/2;

    x.drawImage(fieldImg,dx,dy,w,h);
  }catch(err){
    console.error('Erro ao carregar campo personalizado:',err);
    x.fillStyle='#071927';
    x.fillRect(0,0,c.width,c.height);
  }

  // Jogadores posicionados sobre a imagem
  const players=state.selectedLineup
    .map(id=>state.players.find(p=>p.id===id))
    .filter(Boolean);

  const slots=getPlayerSlots(players);

  slots.forEach(({p,x:px,y:py})=>{
    const cx=(px/100)*c.width;
    const cy=(py/100)*c.height;

    // sombra
    x.beginPath();
    x.fillStyle='rgba(0,0,0,.55)';
    x.arc(cx+4,cy+6,52,0,Math.PI*2);
    x.fill();

    // marcador azul escuro
    x.beginPath();
    x.fillStyle='#061a2d';
    x.arc(cx,cy,50,0,Math.PI*2);
    x.fill();

    // contorno azul
    x.strokeStyle='#09a9f5';
    x.lineWidth=4;
    x.stroke();

    // número
    x.fillStyle='#fff';
    x.textAlign='center';
    x.textBaseline='middle';
    x.font='bold 27px Arial';
    x.fillText(`#${p.number}`,cx,cy-9);

    // nome
    x.font='bold 19px Arial';
    x.fillText(String(p.name).toUpperCase(),cx,cy+19);
  });

  downloadCanvas(c,'escalacao-pandas-fc.png');
}
function downloadCanvas(c,name){const a=document.createElement('a');a.download=name;a.href=c.toDataURL('image/png');a.click();}

const eventForm=document.getElementById('eventForm');
eventForm.addEventListener('submit',async e=>{
  e.preventDefault();
  const id=document.getElementById('eventId').value || uid();
  const old=state.events.find(x=>x.id===id); let logo=old?.logo||'';
  const f=document.getElementById('opponentLogo').files[0]; if(f)logo=await fileToCompressedDataURL(f);
  const obj={
    opponent:document.getElementById('opponentName').value.trim(),
    logo,
    date:document.getElementById('matchDate').value,
    time:document.getElementById('matchTime').value,
    location:document.getElementById('matchLocation').value.trim(),
    goalsFor:old?.goalsFor??'',
    goalsAgainst:old?.goalsAgainst??'',
    updatedAt:serverTimestamp()
  };
  try{
    markWriting();
    await setDoc(doc(db,"events",id),obj,{merge:true});
    eventForm.reset();document.getElementById('eventId').value='';
    toast('Confronto salvo e sincronizado.');
  }catch(err){syncError(err);}
});
document.getElementById('cancelEventEdit').onclick=()=>{eventForm.reset();document.getElementById('eventId').value='';};
function editEvent(id){const e=state.events.find(x=>x.id===id);if(!e)return;document.getElementById('eventId').value=e.id;document.getElementById('opponentName').value=e.opponent||'';document.getElementById('matchDate').value=e.date||'';document.getElementById('matchTime').value=e.time||'';document.getElementById('matchLocation').value=e.location||'';}
async function deleteEvent(id){if(!confirm('Excluir este confronto em todos os dispositivos?'))return;try{markWriting();await deleteDoc(doc(db,"events",id));}catch(err){syncError(err);}}
function statusOf(e){if(e.goalsFor===''||e.goalsAgainst==='')return '';const a=Number(e.goalsFor),b=Number(e.goalsAgainst);return a>b?'VITÓRIA':a<b?'DERROTA':'EMPATE';}
function renderEvents(){
  const sorted=[...state.events].sort((a,b)=>(a.date+a.time).localeCompare(b.date+b.time));
  document.getElementById('eventsList').innerHTML=sorted.length?sorted.map(e=>`
   <div class="list-row"><div class="match-main">${e.logo?`<img class="opponent-logo" src="${e.logo}">`:''}<div><strong>PANDAS FC × ${esc(e.opponent)}</strong><div class="muted">${formatDate(e.date)} • ${e.time} • ${esc(e.location)}</div></div></div>
   <div class="actions"><button onclick="editEvent('${e.id}')">✏️</button><button onclick="generatePoster('${e.id}')">🖼️ Arte</button><button onclick="deleteEvent('${e.id}')">🗑️</button></div></div>`).join(''):'<p class="muted">Nenhuma partida agendada.</p>';
}
function renderMatches(){
 document.getElementById('matchesList').innerHTML=state.events.length?state.events.map(e=>{
   const st=statusOf(e),cls=st==='VITÓRIA'?'win':st==='DERROTA'?'loss':st==='EMPATE'?'draw':'';
   return `<div class="card list-row"><div><strong>PANDAS FC × ${esc(e.opponent)}</strong><div class="muted">${formatDate(e.date)} • ${e.time} • ${esc(e.location)}</div>${st?`<div class="status ${cls}">${st}</div>`:''}</div>
   <div class="score-inputs"><input type="number" min="0" value="${e.goalsFor}" placeholder="0" onchange="setScore('${e.id}','goalsFor',this.value)"><strong>×</strong><input type="number" min="0" value="${e.goalsAgainst}" placeholder="0" onchange="setScore('${e.id}','goalsAgainst',this.value)"></div></div>`;
 }).join(''):'<div class="card"><p class="muted">Cadastre confrontos na Agenda.</p></div>';
}
async function setScore(id,key,v){
  try{
    markWriting();
    await setDoc(doc(db,"events",id),{[key]:v===''?'':Number(v),updatedAt:serverTimestamp()},{merge:true});
  }catch(err){syncError(err);}
}
function formatDate(s){if(!s)return'';const [y,m,d]=s.split('-');return `${d}/${m}/${y}`;}

async function generatePoster(id){
 const e=state.events.find(x=>x.id===id);if(!e)return;
 const c=document.createElement('canvas');c.width=1080;c.height=1350;const x=c.getContext('2d');
 const g=x.createLinearGradient(0,0,1080,1350);g.addColorStop(0,'#080808');g.addColorStop(1,'#363636');x.fillStyle=g;x.fillRect(0,0,1080,1350);
 x.fillStyle='#fff';x.textAlign='center';x.font='bold 54px Arial';x.fillText('DIA DE JOGO',540,130);x.font='bold 42px Arial';x.fillText('PANDAS FC',300,560);x.fillText(e.opponent,780,560);x.font='bold 70px Arial';x.fillText('X',540,560);
 x.font='bold 36px Arial';x.fillText(`${formatDate(e.date)} • ${e.time}`,540,850);x.font='32px Arial';x.fillText(e.location,540,910);
 if(state.teamLogo){try{const im=await loadImage(state.teamLogo);drawContain(x,im,150,260,300,220);}catch{}}
 else {x.font='150px Arial';x.fillText('🐼',300,430);}
 if(e.logo){try{const im=await loadImage(e.logo);drawContain(x,im,630,260,300,220);}catch{}}
 downloadCanvas(c,`pandas-fc-x-${e.opponent.replace(/\s+/g,'-').toLowerCase()}.png`);
}
function loadImage(src){return new Promise((res,rej)=>{const i=new Image();i.onload=()=>res(i);i.onerror=rej;i.src=src;});}
function drawContain(ctx,img,x,y,w,h){const r=Math.min(w/img.width,h/img.height),nw=img.width*r,nh=img.height*r;ctx.drawImage(img,x+(w-nw)/2,y+(h-nh)/2,nw,nh);}

function renderStats(){
 const done=state.events.filter(e=>e.goalsFor!==''&&e.goalsAgainst!=='');let w=0,d=0,l=0,gf=0,ga=0;
 done.forEach(e=>{const a=Number(e.goalsFor),b=Number(e.goalsAgainst);gf+=a;ga+=b;if(a>b)w++;else if(a<b)l++;else d++;});
 const pts=w*3+d,ap=done.length?Math.round((pts/(done.length*3))*100):0;
 const cards=[['Jogos',done.length],['Vitórias',w],['Empates',d],['Derrotas',l],['Gols marcados',gf],['Gols sofridos',ga],['Saldo',gf-ga],['Aproveitamento',ap+'%']];
 document.getElementById('statsCards').innerHTML=cards.map(([a,b])=>`<div class="stat-card"><span>${a}</span><strong>${b}</strong></div>`).join('');
 document.getElementById('historyList').innerHTML=done.length?[...done].sort((a,b)=>(b.date+b.time).localeCompare(a.date+a.time)).map(e=>`<div class="list-row"><div><strong>PANDAS FC ${e.goalsFor} × ${e.goalsAgainst} ${esc(e.opponent)}</strong><div class="muted">${formatDate(e.date)}</div></div><span class="status ${statusOf(e)==='VITÓRIA'?'win':statusOf(e)==='DERROTA'?'loss':'draw'}">${statusOf(e)}</span></div>`).join(''):'<p class="muted">Nenhuma partida finalizada.</p>';
}
function renderScorers(){
 const arr=[...state.players].sort((a,b)=>(b.goals||0)-(a.goals||0)||String(a.name||'').localeCompare(String(b.name||'')));
 document.getElementById('scorersList').innerHTML=arr.length?arr.map((p,i)=>`<div class="list-row"><div style="display:flex;align-items:center;gap:12px"><div class="rank-badge">${i+1}</div><div><strong>#${p.number} ${esc(p.name)}</strong><div class="muted">${esc(p.position)}</div></div></div><label>Gols <input class="goal-input" type="number" min="0" value="${p.goals||0}" onchange="setGoals('${p.id}',this.value)"></label></div>`).join(''):'<p class="muted">Nenhum jogador cadastrado.</p>';
}
async function setGoals(id,v){try{markWriting();await setDoc(doc(db,"players",id),{goals:Math.max(0,Number(v)||0),updatedAt:serverTimestamp()},{merge:true});}catch(err){syncError(err);}}

let calDate=new Date();document.getElementById('prevMonth').onclick=()=>{calDate.setMonth(calDate.getMonth()-1);renderCalendar();};document.getElementById('nextMonth').onclick=()=>{calDate.setMonth(calDate.getMonth()+1);renderCalendar();};
function renderCalendar(){
 const y=calDate.getFullYear(),m=calDate.getMonth();document.getElementById('calendarTitle').textContent=new Intl.DateTimeFormat('pt-BR',{month:'long',year:'numeric'}).format(calDate);
 const root=document.getElementById('calendar');const dows=['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];let html=dows.map(d=>`<div class="dow">${d}</div>`).join('');
 const first=new Date(y,m,1).getDay(),days=new Date(y,m+1,0).getDate();for(let i=0;i<first;i++)html+='<div></div>';
 for(let d=1;d<=days;d++){const ds=`${y}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;const ev=state.events.some(e=>e.date===ds);html+=`<div class="day ${ev?'has-event':''}" title="${ev?'Há partida neste dia':''}">${d}</div>`;}root.innerHTML=html;
}

document.getElementById('teamLogoInput').addEventListener('change',async e=>{
  const f=e.target.files[0];if(!f)return;
  try{
    const logo=await fileToCompressedDataURL(f,600,.75);
    markWriting();
    await setDoc(doc(db,"settings","team"),{teamLogo:logo,updatedAt:serverTimestamp()},{merge:true});
    toast('Logo atualizada e sincronizada.');
  }catch(err){syncError(err);}
});
function renderLogo(){
  const img=document.getElementById('dashboardLogo');
  const ph=document.getElementById('dashboardPlaceholder');
  const headerImg=document.getElementById('headerLogo');
  const headerFallback=document.getElementById('headerLogoFallback');

  if(headerImg && state.teamLogo){
    headerImg.src=state.teamLogo;
    headerImg.classList.remove('hidden');
    if(headerFallback) headerFallback.classList.add('hidden');
  }else{
    if(headerImg) headerImg.classList.add('hidden');
    if(headerFallback) headerFallback.classList.remove('hidden');
  }

  if(state.dashboardMedia?.data || state.dashboardMedia?.url){
    img.classList.add('hidden');
    ph.classList.add('hidden');
    return;
  }

  if(state.teamLogo){
    img.src=state.teamLogo;
    img.classList.remove('hidden');
    ph.classList.add('hidden');
  }else{
    img.classList.add('hidden');
    ph.classList.remove('hidden');
  }
}


function youtubeEmbedUrl(url){
  try{
    const u=new URL(url);
    let id="";
    if(u.hostname.includes("youtu.be")){
      id=u.pathname.split("/").filter(Boolean)[0]||"";
    }else if(u.hostname.includes("youtube.com")){
      if(u.pathname.startsWith("/watch")) id=u.searchParams.get("v")||"";
      else if(u.pathname.startsWith("/shorts/")) id=u.pathname.split("/")[2]||"";
      else if(u.pathname.startsWith("/embed/")) id=u.pathname.split("/")[2]||"";
    }
    return id ? `https://www.youtube.com/embed/${id}?autoplay=1&mute=1&loop=1&playlist=${id}&playsinline=1` : "";
  }catch{return "";}
}

function showDashboardMediaError(message){
  const box=document.getElementById('dashboardMediaError');
  if(!box) return;
  box.textContent=message;
  box.classList.remove('hidden');
}

function renderDashboardMedia(){
  const img=document.getElementById('dashboardMediaImage');
  const video=document.getElementById('dashboardMediaVideo');
  const frame=document.getElementById('dashboardMediaFrame');
  const errorBox=document.getElementById('dashboardMediaError');
  const logo=document.getElementById('dashboardLogo');
  const ph=document.getElementById('dashboardPlaceholder');
  if(!img || !video || !frame) return;

  img.classList.add('hidden');
  video.classList.add('hidden');
  frame.classList.add('hidden');
  if(errorBox){ errorBox.classList.add('hidden'); errorBox.textContent=''; }

  video.pause();
  video.removeAttribute('src');
  video.load();
  frame.removeAttribute('src');
  img.removeAttribute('src');

  const media=state.dashboardMedia || {};
  const src=media.data || media.url || '';

  if(!src){
    renderLogo();
    return;
  }

  logo.classList.add('hidden');
  ph.classList.add('hidden');

  const type=(media.type || '').toLowerCase();
  const mode=(media.urlMode || 'auto').toLowerCase();

  let isYoutube = mode==='youtube';
  let isVideo = mode==='video';
  let isImage = mode==='image';

  if(mode==='auto'){
    isYoutube = /(?:youtube\.com|youtu\.be)/i.test(src);
    isVideo = type.startsWith('video/') || /\.(mp4|webm|mov)(?:\?|#|$)/i.test(src);
    isImage = type.startsWith('image/') || /\.(png|gif|jpg|jpeg|webp)(?:\?|#|$)/i.test(src);
    if(!isYoutube && !isVideo && !isImage){
      // Unknown URL: try as image first because image errors are fast.
      isImage = true;
    }
  }

  if(isYoutube){
    const embed=youtubeEmbedUrl(src);
    if(!embed){
      showDashboardMediaError('Não consegui reconhecer esse link do YouTube. Use um link como youtube.com/watch?v=... ou youtu.be/...');
      return;
    }
    frame.src=embed;
    frame.classList.remove('hidden');
    return;
  }

  if(isVideo){
    video.onerror=()=>{
      video.classList.add('hidden');
      showDashboardMediaError('O vídeo não pôde ser reproduzido. Para URL, use um link direto para arquivo MP4/WebM (o endereço normalmente termina em .mp4 ou .webm), ou selecione YouTube quando for um link do YouTube.');
    };
    video.oncanplay=()=>{
      if(errorBox) errorBox.classList.add('hidden');
      video.play().catch(()=>{});
    };
    video.src=src;
    video.classList.remove('hidden');
    video.load();
    return;
  }

  img.onerror=()=>{
    img.classList.add('hidden');
    showDashboardMediaError('A imagem/GIF não pôde ser carregada. Se estiver usando uma URL, ela precisa apontar diretamente para a imagem/GIF. Se o link for de vídeo, selecione “Vídeo MP4 / WebM” ou “YouTube”.');
  };
  img.onload=()=>{ if(errorBox) errorBox.classList.add('hidden'); };
  img.src=src;
  img.classList.remove('hidden');
}

document.getElementById('dashboardMediaInput').addEventListener('change', async e=>{
  const file=e.target.files?.[0];
  if(!file) return;

  const allowed=['image/png','image/gif','video/mp4','video/webm'];
  if(!allowed.includes(file.type)){
    alert('Formato não suportado. Use PNG, GIF, MP4 ou WebM.');
    e.target.value='';
    return;
  }

  if(file.size > 700 * 1024){
    alert('Esse arquivo é maior que 700 KB. O Firestore não é indicado para armazenar vídeos grandes. Para vídeos maiores, use uma URL direta para MP4/WebM ou um link do YouTube.');
    e.target.value='';
    return;
  }

  try{
    markWriting();
    const data=await fileToDataURL(file);
    await setDoc(doc(db,'settings','dashboard'),{
      mediaType:file.type,
      mediaData:data,
      mediaUrl:'',
      urlMode:file.type.startsWith('video/') ? 'video' : 'image',
      updatedAt:serverTimestamp()
    },{merge:true});
    document.getElementById('dashboardMediaUrl').value='';
    toast('Mídia do Dashboard atualizada e sincronizada.');
  }catch(err){syncError(err);}
});

document.getElementById('saveDashboardMediaUrl').onclick=async()=>{
  const url=document.getElementById('dashboardMediaUrl').value.trim();
  const mode=document.getElementById('dashboardMediaUrlType').value || 'auto';

  if(!url){
    alert('Informe uma URL.');
    return;
  }

  try{ new URL(url); }
  catch{
    alert('A URL informada não é válida.');
    return;
  }

  const lower=url.toLowerCase();
  let type='remote/auto';

  if(mode==='video') type='video/remote';
  else if(mode==='image') type='image/remote';
  else if(mode==='youtube') type='video/youtube';
  else{
    if(/(?:youtube\.com|youtu\.be)/i.test(lower)) type='video/youtube';
    else if(/\.(mp4)(?:\?|#|$)/i.test(lower)) type='video/mp4';
    else if(/\.(webm)(?:\?|#|$)/i.test(lower)) type='video/webm';
    else if(/\.(gif)(?:\?|#|$)/i.test(lower)) type='image/gif';
    else if(/\.(png)(?:\?|#|$)/i.test(lower)) type='image/png';
    else if(/\.(jpe?g|webp)(?:\?|#|$)/i.test(lower)) type='image/remote';
  }

  try{
    markWriting();
    await setDoc(doc(db,'settings','dashboard'),{
      mediaType:type,
      mediaData:'',
      mediaUrl:url,
      urlMode:mode,
      updatedAt:serverTimestamp()
    },{merge:true});
    toast('URL do Dashboard salva e sincronizada.');
  }catch(err){syncError(err);}
};

document.getElementById('removeDashboardMedia').onclick=async()=>{
  if(!confirm('Remover a mídia do Início / Dashboard em todos os dispositivos?')) return;
  try{
    markWriting();
    await setDoc(doc(db,'settings','dashboard'),{
      mediaType:'',
      mediaData:'',
      mediaUrl:'',
      urlMode:'auto',
      updatedAt:serverTimestamp()
    },{merge:true});
    document.getElementById('dashboardMediaUrl').value='';
    document.getElementById('dashboardMediaUrlType').value='auto';
    toast('Mídia removida.');
  }catch(err){syncError(err);}
};

document.getElementById('clearDataBtn').onclick=async()=>{
  if(!confirm('Apagar jogadores, partidas, escalação e logo do Firebase? Isso afetará todos os dispositivos.'))return;
  try{
    markWriting();
    const ps=await getDocs(collection(db,"players"));
    await Promise.all(ps.docs.map(d=>deleteDoc(d.ref)));
    const es=await getDocs(collection(db,"events"));
    await Promise.all(es.docs.map(d=>deleteDoc(d.ref)));
    await deleteDoc(doc(db,"settings","team")).catch(()=>{});
    await deleteDoc(doc(db,"settings","dashboard")).catch(()=>{});
    await deleteDoc(doc(db,"lineup","current")).catch(()=>{});
    toast('Dados do Firebase apagados.');
  }catch(err){syncError(err);}
};

document.getElementById('migrateBtn').onclick=async()=>{
  const raw=localStorage.getItem('pandasfc_data_v4');
  if(!raw){alert('Não encontrei dados antigos salvos neste navegador.');return;}
  if(!confirm('Importar os dados antigos deste dispositivo para o Firebase?'))return;
  try{
    const old=JSON.parse(raw);
    markWriting();
    for(const p of old.players||[]){
      await setDoc(doc(db,"players",p.id||uid()),{
        name:p.name||'',position:p.position||'',number:Number(p.number)||0,goals:Number(p.goals)||0,updatedAt:serverTimestamp()
      },{merge:true});
    }
    for(const e of old.events||[]){
      await setDoc(doc(db,"events",e.id||uid()),{
        opponent:e.opponent||'',logo:e.logo||'',date:e.date||'',time:e.time||'',location:e.location||'',
        goalsFor:e.goalsFor??'',goalsAgainst:e.goalsAgainst??'',updatedAt:serverTimestamp()
      },{merge:true});
    }
    if(old.teamLogo) await setDoc(doc(db,"settings","team"),{teamLogo:old.teamLogo,updatedAt:serverTimestamp()},{merge:true});
    if(old.selectedLineup) await setDoc(doc(db,"lineup","current"),{playerIds:old.selectedLineup,updatedAt:serverTimestamp()},{merge:true});
    toast('Dados antigos importados para o Firebase.');
  }catch(err){syncError(err);}
};

document.getElementById('notifyBtn').onclick=async()=>{if(!('Notification'in window)){alert('Este navegador não suporta notificações.');return;}const p=await Notification.requestPermission();toast(p==='granted'?'Notificações ativadas.':'Permissão não concedida.');};
function checkTodayMatches(){
 if(!('Notification'in window)||Notification.permission!=='granted')return;
 const today=new Date().toISOString().slice(0,10);const k='pandasfc_notified_'+today;if(localStorage.getItem(k))return;
 const evs=state.events.filter(e=>e.date===today);if(!evs.length)return;
 evs.forEach(e=>new Notification('⚽ Hoje tem PANDAS FC!',{body:`PANDAS FC × ${e.opponent} • ${e.time} • ${e.location}`,icon:'./icon-192.png'}));localStorage.setItem(k,'1');
}

let deferredPrompt=null;
window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();deferredPrompt=e;});
async function installApp(){
 if(deferredPrompt){deferredPrompt.prompt();await deferredPrompt.userChoice;deferredPrompt=null;return;}
 alert('Se a instalação automática não abrir, no Android use o menu ⋮ do Chrome e escolha “Instalar app” ou “Adicionar à tela inicial”. No computador, procure o ícone de instalação na barra de endereço do Chrome/Edge.');
}
document.getElementById('installBtn').onclick=installApp;document.getElementById('installBtn2').onclick=installApp;
window.addEventListener('appinstalled',()=>toast('PANDAS FC instalado com sucesso.'));

if('serviceWorker'in navigator){
  window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').catch(console.error));
}

window.editPlayer=editPlayer;
window.deletePlayer=deletePlayer;
window.toggleLineup=toggleLineup;
window.editEvent=editEvent;
window.deleteEvent=deleteEvent;
window.generatePoster=generatePoster;
window.setScore=setScore;
window.setGoals=setGoals;

renderPlayers(); renderLineup(); renderEvents(); renderMatches(); renderStats(); renderScorers(); renderCalendar(); renderLogo(); renderDashboardMedia();
connectRealtime();
