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

const PUSH_WORKER_URL = "https://pandas-fc-push.abimaeltablet.workers.dev/";

function getAlertLabel(value){
  const labels={
    "15":"15 min antes",
    "30":"30 min antes",
    "60":"1 hora antes",
    "120":"2 horas antes",
    "360":"6 horas antes",
    "720":"12 horas antes",
    "1440":"1 dia antes",
    "custom":"horário personalizado"
  };
  return labels[String(value)] || "1 hora antes";
}

function getAlertDateISO(date,time,alertValue,customValue=""){
  if(alertValue==="custom"){
    if(!customValue) throw new Error("Escolha o horário personalizado do alerta.");
    const customDate=new Date(customValue);
    if(Number.isNaN(customDate.getTime())) throw new Error("Horário personalizado inválido.");
    return customDate.toISOString();
  }

  const matchDate=new Date(`${date}T${time}:00`);
  if(Number.isNaN(matchDate.getTime())) throw new Error("Data ou hora da partida inválida.");

  const minutes=Number(alertValue || 60);
  return new Date(matchDate.getTime() - minutes*60*1000).toISOString();
}

async function callPushWorker(payload){
  const response=await fetch(PUSH_WORKER_URL,{
    method:"POST",
    headers:{"Content-Type":"application/json"},
    body:JSON.stringify(payload)
  });

  let result={};
  try{ result=await response.json(); }catch{}

  if(!response.ok || result.ok===false){
    const detail=result?.details?.errors?.join?.(" • ") ||
                 result?.details?.errors?.[0] ||
                 result?.error ||
                 `Erro HTTP ${response.status}`;
    throw new Error(detail);
  }

  return result;
}

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
const matchAlert=document.getElementById('matchAlert');
const customAlertWrap=document.getElementById('customAlertWrap');
const customAlertTime=document.getElementById('customAlertTime');

function updateCustomAlertVisibility(){
  if(!matchAlert || !customAlertWrap)return;
  const custom=matchAlert.value==='custom';
  customAlertWrap.classList.toggle('hidden',!custom);
  if(customAlertTime) customAlertTime.required=custom;
}

if(matchAlert){
  matchAlert.addEventListener('change',updateCustomAlertVisibility);
  updateCustomAlertVisibility();
}

eventForm.addEventListener('submit',async e=>{
  e.preventDefault();

  const id=document.getElementById('eventId').value || uid();
  const old=state.events.find(x=>x.id===id);
  let logo=old?.logo||'';
  const f=document.getElementById('opponentLogo').files[0];
  if(f)logo=await fileToCompressedDataURL(f);

  const opponent=document.getElementById('opponentName').value.trim();
  const date=document.getElementById('matchDate').value;
  const time=document.getElementById('matchTime').value;
  const location=document.getElementById('matchLocation').value.trim();
  const alertValue=matchAlert?.value || '60';
  const customValue=customAlertTime?.value || '';

  let alertAt;
  try{
    alertAt=getAlertDateISO(date,time,alertValue,customValue);
  }catch(err){
    alert(err.message);
    return;
  }

  if(new Date(alertAt).getTime() <= Date.now()){
    alert('O horário do alerta precisa estar no futuro. Escolha uma antecedência menor ou um horário personalizado.');
    return;
  }

  const obj={
    opponent,
    logo,
    date,
    time,
    location,
    alertValue,
    alertAt,
    customAlertTime:alertValue==='custom' ? customValue : '',
    goalsFor:old?.goalsFor??'',
    goalsAgainst:old?.goalsAgainst??'',
    notificationMessageId:old?.notificationMessageId||'',
    updatedAt:serverTimestamp()
  };

  try{
    markWriting();

    // Agenda primeiro a nova notificação. Se for edição, informa o ID anterior
    // para o Worker cancelar a notificação antiga após criar a nova.
    const pushResult=await callPushWorker({
      action:"schedule",
      opponent,
      date:formatDate(date),
      time,
      location,
      sendAt:alertAt,
      alertLabel:getAlertLabel(alertValue),
      previousMessageId:old?.notificationMessageId||null,
      message:
        `PANDAS FC x ${opponent}\n` +
        `🕐 ${formatDate(date)} às ${time}\n` +
        `${location ? `📍 ${location}\n` : ''}` +
        `🔔 Alerta: ${getAlertLabel(alertValue)}`
    });

    obj.notificationMessageId=pushResult.messageId || '';

    await setDoc(doc(db,"events",id),obj,{merge:true});

    eventForm.reset();
    document.getElementById('eventId').value='';
    if(matchAlert) matchAlert.value='60';
    if(customAlertTime) customAlertTime.value='';
    updateCustomAlertVisibility();

    toast(`Confronto salvo. 🔔 Alerta: ${getAlertLabel(alertValue)}.`);
  }catch(err){
    console.error('Erro ao agendar alerta:',err);
    setSyncStatus("⚠️ Erro ao agendar alerta","err");
    alert(`Não foi possível agendar a notificação.\n\n${err.message}`);
  }
});

document.getElementById('cancelEventEdit').onclick=()=>{
  eventForm.reset();
  document.getElementById('eventId').value='';
  if(matchAlert) matchAlert.value='60';
  if(customAlertTime) customAlertTime.value='';
  updateCustomAlertVisibility();
};

function editEvent(id){
  const e=state.events.find(x=>x.id===id);
  if(!e)return;

  document.getElementById('eventId').value=e.id;
  document.getElementById('opponentName').value=e.opponent||'';
  document.getElementById('matchDate').value=e.date||'';
  document.getElementById('matchTime').value=e.time||'';
  document.getElementById('matchLocation').value=e.location||'';

  if(matchAlert) matchAlert.value=String(e.alertValue||'60');
  if(customAlertTime) customAlertTime.value=e.customAlertTime||'';
  updateCustomAlertVisibility();

  document.querySelector('[data-page="agenda"]')?.click();
  eventForm.scrollIntoView({behavior:'smooth',block:'start'});
}

async function deleteEvent(id){
  const e=state.events.find(x=>x.id===id);
  if(!e)return;
  if(!confirm('Excluir este confronto e cancelar a notificação agendada?'))return;

  try{
    markWriting();

    if(e.notificationMessageId){
      try{
        await callPushWorker({
          action:"cancel",
          messageId:e.notificationMessageId
        });
      }catch(cancelErr){
        console.warn('Não foi possível cancelar o alerta no OneSignal:',cancelErr);
      }
    }

    await deleteDoc(doc(db,"events",id));
    toast('Confronto excluído e alerta cancelado.');
  }catch(err){
    syncError(err);
  }
}

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
  const e=state.events.find(x=>x.id===id);
  if(!e)return;

  const c=document.createElement('canvas');
  c.width=1080;
  c.height=1920;
  const x=c.getContext('2d');

  try{
    const bg=await loadImage('./background-partida-pandas.png');
    const scale=Math.max(c.width/bg.width,c.height/bg.height);
    const w=bg.width*scale;
    const h=bg.height*scale;
    const dx=(c.width-w)/2;
    const dy=(c.height-h)/2;
    x.drawImage(bg,dx,dy,w,h);
  }catch(err){
    const g=x.createLinearGradient(0,0,1080,1920);
    g.addColorStop(0,'#03182a');
    g.addColorStop(1,'#07101b');
    x.fillStyle=g;
    x.fillRect(0,0,c.width,c.height);
  }

  x.fillStyle='rgba(0,12,28,.72)';
  x.roundRect(90,500,900,760,34);
  x.fill();

  x.textAlign='center';
  x.fillStyle='#ffffff';
  x.font='bold 62px Arial';
  x.fillText('DIA DE JOGO',540,590);

  x.fillStyle='#14a8f5';
  x.font='bold 28px Arial';
  x.fillText('PANDAS FUTEBOL CLUBE',540,640);

  const logoY=710, logoW=280, logoH=280;

  if(state.teamLogo){
    try{
      const im=await loadImage(state.teamLogo);
      drawContain(x,im,120,logoY,logoW,logoH);
    }catch{}
  }else{
    x.font='170px Arial';
    x.fillStyle='#fff';
    x.fillText('🐼',260,900);
  }

  if(e.logo){
    try{
      const im=await loadImage(e.logo);
      drawContain(x,im,680,logoY,logoW,logoH);
    }catch{}
  }

  x.fillStyle='#14a8f5';
  x.font='bold 72px Arial';
  x.fillText('X',540,865);

  x.fillStyle='#ffffff';
  x.font='bold 34px Arial';
  x.fillText('PANDAS FC',260,1045);

  const opponentName=String(e.opponent||'ADVERSÁRIO').toUpperCase();
  x.fillText(opponentName.length>18 ? opponentName.slice(0,18) : opponentName,820,1045);

  x.fillStyle='rgba(0,12,28,.86)';
  x.roundRect(145,1310,790,340,28);
  x.fill();

  x.fillStyle='#ffffff';
  x.font='bold 42px Arial';
  x.fillText(`${formatDate(e.date)} • ${e.time}`,540,1410);

  x.fillStyle='#14a8f5';
  x.font='bold 30px Arial';
  x.fillText('LOCAL DA PARTIDA',540,1490);

  x.fillStyle='#ffffff';
  x.font='30px Arial';
  const location=String(e.location||'').toUpperCase();
  x.fillText(location.length>34 ? location.slice(0,34) : location,540,1545);

  x.fillStyle='#14a8f5';
  x.font='bold 24px Arial';
  x.fillText('DISCIPLINA • UNIÃO • PAIXÃO',540,1770);

  x.fillStyle='#ffffff';
  x.font='20px Arial';
  x.fillText('JOGO A JOGO, SONHO A SONHO.',540,1810);

  downloadCanvas(
    c,
    `pandas-fc-x-${e.opponent.replace(/\s+/g,'-').toLowerCase()}.png`
  );
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

const notifyBtn=document.getElementById('notifyBtn');
const pushStatus=document.getElementById('pushStatus');

const diagEls={
  permission:document.getElementById('diagPermission'),
  oneSignal:document.getElementById('diagOneSignal'),
  optedIn:document.getElementById('diagOptedIn'),
  subscriptionId:document.getElementById('diagSubscriptionId'),
  pushToken:document.getElementById('diagPushToken'),
  browserPush:document.getElementById('diagBrowserPush'),
  serviceWorker:document.getElementById('diagServiceWorker'),
  workerScope:document.getElementById('diagWorkerScope'),
  message:document.getElementById('diagMessage')
};

function setPushStatus(text,type=''){
  if(!pushStatus)return;
  pushStatus.textContent=text;
  pushStatus.className=`push-status ${type}`.trim();
}
function setDiag(el,value,type=''){
  if(!el)return;
  el.textContent=value;
  el.className=type;
}
function wait(ms){ return new Promise(r=>setTimeout(r,ms)); }

async function getBrowserPushInfo(){
  const result={hasRegistration:false,hasSubscription:false,scriptURL:'',scope:''};
  if(!('serviceWorker' in navigator))return result;
  try{
    const regs=await navigator.serviceWorker.getRegistrations();
    const reg=
      regs.find(r=>String(r.scope||'').includes('/PandasFc/push/onesignal/')) ||
      regs.find(r=>String(r.active?.scriptURL||r.installing?.scriptURL||r.waiting?.scriptURL||'').includes('OneSignalSDKWorker.js')) ||
      null;
    if(reg){
      result.hasRegistration=true;
      result.scope=reg.scope||'';
      result.scriptURL=reg.active?.scriptURL||reg.waiting?.scriptURL||reg.installing?.scriptURL||'';
      try{ result.hasSubscription=!!(await reg.pushManager.getSubscription()); }catch{}
    }
  }catch(err){ console.warn('Diagnóstico SW:',err); }
  return result;
}

async function getPushDiagnostic(){
  const browserPermission=('Notification' in window)?Notification.permission:'unsupported';
  const OneSignal=window.PandasOneSignal;
  const browserPush=await getBrowserPushInfo();
  let optedIn=false, subscriptionId='', token='';
  if(OneSignal){
    try{
      optedIn=!!OneSignal.User.PushSubscription.optedIn;
      subscriptionId=OneSignal.User.PushSubscription.id||'';
      token=OneSignal.User.PushSubscription.token||'';
    }catch(err){ console.warn('Leitura OneSignal:',err); }
  }
  return {browserPermission,oneSignalLoaded:!!OneSignal,optedIn,subscriptionId,token,...browserPush};
}

async function renderPushDiagnostic(){
  const d=await getPushDiagnostic();

  setDiag(diagEls.permission,
    d.browserPermission==='granted'?'GRANTED ✅':
    d.browserPermission==='denied'?'BLOQUEADA ❌':
    d.browserPermission==='default'?'AGUARDANDO ⚠️':'NÃO SUPORTADO ❌',
    d.browserPermission==='granted'?'diag-ok':'diag-bad');

  setDiag(diagEls.oneSignal,d.oneSignalLoaded?'SIM ✅':'NÃO ❌',d.oneSignalLoaded?'diag-ok':'diag-bad');
  setDiag(diagEls.optedIn,
    d.optedIn&&d.subscriptionId?'SIM ✅':
    d.optedIn&&!d.subscriptionId?'INCONSISTENTE ⚠️':'NÃO ❌',
    d.optedIn&&d.subscriptionId?'diag-ok':'diag-bad');

  setDiag(diagEls.subscriptionId,d.subscriptionId||'NENHUM ❌',
    d.subscriptionId?'diag-ok diagnostic-value':'diag-bad diagnostic-value');
  setDiag(diagEls.pushToken,d.token?'DISPONÍVEL ✅':'NENHUM ❌',d.token?'diag-ok':'diag-bad');
  setDiag(diagEls.browserPush,d.hasSubscription?'EXISTE ✅':'NÃO EXISTE ❌',d.hasSubscription?'diag-ok':'diag-bad');
  setDiag(diagEls.serviceWorker,
    d.hasRegistration?(d.scriptURL?d.scriptURL.split('/').pop()+' ✅':'REGISTRADO ✅'):'NÃO REGISTRADO ❌',
    d.hasRegistration?'diag-ok diagnostic-value':'diag-bad');
  setDiag(diagEls.workerScope,d.scope||'NENHUM',d.scope?'diagnostic-value':'diag-bad');

  if(diagEls.message){
    if(d.browserPermission==='granted'&&d.optedIn&&d.subscriptionId&&d.hasSubscription){
      diagEls.message.textContent='✅ Push está completamente inscrito.';
      diagEls.message.className='push-status ok';
    }else if(d.browserPermission==='granted'&&!d.subscriptionId){
      diagEls.message.textContent='⚠️ O navegador permite notificações, mas não existe Subscription ID no OneSignal.';
      diagEls.message.className='push-status err';
    }else{
      diagEls.message.textContent='Use “Recriar inscrição Push” para tentar corrigir.';
      diagEls.message.className='push-status';
    }
  }
  return d;
}

async function refreshPushStatus(){
  const d=await renderPushDiagnostic();
  if(d.browserPermission==='granted'&&d.optedIn&&d.subscriptionId){
    setPushStatus('✅ Notificações push realmente inscritas','ok');
    if(notifyBtn)notifyBtn.textContent='🔔 Notificações ativadas';
  }else if(d.browserPermission==='denied'){
    setPushStatus('🚫 Notificações bloqueadas no navegador','err');
    if(notifyBtn)notifyBtn.textContent='🔕 Notificações bloqueadas';
  }else if(d.oneSignalLoaded&&d.browserPermission==='granted'&&!d.subscriptionId){
    setPushStatus('⚠️ Permitido, mas sem inscrição no OneSignal','err');
    if(notifyBtn)notifyBtn.textContent='🛠️ Criar inscrição Push';
  }else{
    setPushStatus('🔔 Toque para permitir/inscrever notificações');
    if(notifyBtn)notifyBtn.textContent='🔔 Ativar notificações';
  }
}

async function enablePushNotifications(){
  const OneSignal=window.PandasOneSignal;
  if(!OneSignal){ toast('OneSignal ainda está carregando.'); return; }
  try{
    if(Notification.permission!=='granted') await OneSignal.Notifications.requestPermission();
    if(OneSignal.Notifications.permission){
      await OneSignal.User.PushSubscription.optIn();
      await wait(1500);
    }
    await refreshPushStatus();
    toast(OneSignal.User.PushSubscription.id?'Push ativado e inscrito.':'Permissão concedida, mas sem Subscription ID.');
  }catch(err){
    console.error(err);
    setPushStatus('⚠️ Erro ao ativar notificações','err');
    await renderPushDiagnostic();
  }
}

async function recreatePushSubscription(){
  const OneSignal=window.PandasOneSignal;
  if(!OneSignal){ alert('OneSignal ainda está carregando. Tente novamente em alguns segundos.'); return; }

  const btn=document.getElementById('recreatePushBtn');
  const oldText=btn?.textContent;
  try{
    if(btn){ btn.disabled=true; btn.textContent='⏳ Recriando inscrição...'; }

    if(Notification.permission!=='granted') await OneSignal.Notifications.requestPermission();
    if(Notification.permission!=='granted') throw new Error('Permissão de notificações não concedida.');

    try{ await OneSignal.User.PushSubscription.optOut(); }catch{}
    await wait(500);

    try{
      const regs=await navigator.serviceWorker.getRegistrations();
      const reg=
        regs.find(r=>String(r.scope||'').includes('/PandasFc/push/onesignal/')) ||
        regs.find(r=>String(r.active?.scriptURL||r.installing?.scriptURL||r.waiting?.scriptURL||'').includes('OneSignalSDKWorker.js')) ||
        null;
      if(reg){
        const nativeSub=await reg.pushManager.getSubscription();
        if(nativeSub) await nativeSub.unsubscribe();
      }
    }catch(err){ console.warn('Reset Push nativo:',err); }

    await wait(800);
    await OneSignal.User.PushSubscription.optIn();

    let newId='';
    for(let i=0;i<10;i++){
      await wait(700);
      newId=OneSignal.User.PushSubscription.id||'';
      if(newId)break;
    }

    await refreshPushStatus();

    if(newId){
      alert('Inscrição Push recriada com sucesso!\\n\\nSubscription ID:\\n'+newId+'\\n\\nAtualize Audience → Subscriptions no OneSignal.');
    }else{
      alert('Ainda não foi criado um Subscription ID. Tire um print do painel de diagnóstico e me envie.');
    }
  }catch(err){
    console.error(err);
    alert('Erro ao recriar inscrição Push:\\n\\n'+(err?.message||err));
    await refreshPushStatus();
  }finally{
    if(btn){ btn.disabled=false; btn.textContent=oldText||'🛠️ Recriar inscrição Push'; }
  }
}

if(notifyBtn)notifyBtn.onclick=enablePushNotifications;
document.getElementById('refreshPushDiag')?.addEventListener('click',refreshPushStatus);
document.getElementById('recreatePushBtn')?.addEventListener('click',recreatePushSubscription);

window.addEventListener('pandas-onesignal-ready',()=>{
  refreshPushStatus();
  try{
    window.PandasOneSignal.Notifications.addEventListener('permissionChange',refreshPushStatus);
    window.PandasOneSignal.User.PushSubscription.addEventListener('change',()=>setTimeout(refreshPushStatus,300));
  }catch(err){ console.warn('Listener OneSignal:',err); }
});

document.addEventListener('visibilitychange',()=>{
  if(!document.hidden)setTimeout(refreshPushStatus,400);
});


async function runTechnicalPushTest(){
  const out=document.getElementById('technicalPushOutput');
  const btn=document.getElementById('runTechnicalPushTest');

  const lines=[];
  const add=(label,value)=>{
    const text=typeof value==='string' ? value : JSON.stringify(value,null,2);
    lines.push(`${label}: ${text}`);
    if(out) out.textContent=lines.join('\n\n');
  };

  const addError=(label,err)=>{
    add(label,{
      name:err?.name||'Error',
      message:err?.message||String(err),
      stack:err?.stack||''
    });
  };

  if(btn){
    btn.disabled=true;
    btn.textContent='⏳ Testando...';
  }

  try{
    add('Data/hora',new Date().toString());
    add('URL atual',location.href);
    add('Origem',location.origin);
    add('Notification.permission',
      ('Notification' in window) ? Notification.permission : 'unsupported');
    add('Secure context',window.isSecureContext);
    add('User Agent',navigator.userAgent);

    // Service Worker
    if(!('serviceWorker' in navigator)){
      add('Service Worker','NÃO SUPORTADO');
      return;
    }

    const regs=await navigator.serviceWorker.getRegistrations();
    add('Quantidade de registrations',regs.length);

    regs.forEach((reg,i)=>{
      add(`Registration ${i+1}`,{
        scope:reg.scope,
        active:reg.active?.scriptURL||null,
        waiting:reg.waiting?.scriptURL||null,
        installing:reg.installing?.scriptURL||null
      });
    });

    const reg=
      regs.find(r=>String(r.scope||'').includes('/PandasFc/push/onesignal/')) ||
      regs.find(r=>String(r.active?.scriptURL||r.installing?.scriptURL||r.waiting?.scriptURL||'').includes('OneSignalSDKWorker.js')) ||
      null;

    if(!reg){
      add('Registration do PANDAS FC','NÃO ENCONTRADA');
      try{
        add('Tentando registrar ./sw.js','...');
        const newReg=await navigator.serviceWorker.register('./sw.js',{scope:'./'});
        add('Registro manual concluído',{
          scope:newReg.scope,
          active:newReg.active?.scriptURL||null
        });
      }catch(err){
        addError('ERRO ao registrar ./sw.js',err);
      }
      return;
    }

    add('Registration escolhida',{
      scope:reg.scope,
      active:reg.active?.scriptURL||null
    });

    try{
      await reg.update();
      add('registration.update()','OK');
    }catch(err){
      addError('registration.update() ERRO',err);
    }

    try{
      const ready=await Promise.race([
        navigator.serviceWorker.ready,
        new Promise((_,rej)=>setTimeout(()=>rej(new Error('Timeout aguardando navigator.serviceWorker.ready')),5000))
      ]);
      add('navigator.serviceWorker.ready',{
        scope:ready.scope,
        active:ready.active?.scriptURL||null
      });
    }catch(err){
      addError('navigator.serviceWorker.ready ERRO',err);
    }

    add('navigator.serviceWorker.controller',
      navigator.serviceWorker.controller?.scriptURL || 'NENHUM');

    try{
      const nativeSub=await reg.pushManager.getSubscription();
      add('PushManager.getSubscription()',nativeSub ? {
        endpoint:nativeSub.endpoint,
        expirationTime:nativeSub.expirationTime,
        hasP256dh:!!nativeSub.getKey('p256dh'),
        hasAuth:!!nativeSub.getKey('auth')
      } : 'NULL');
    }catch(err){
      addError('PushManager.getSubscription() ERRO',err);
    }

    // Verify SW file is reachable
    try{
      const swUrl=new URL('./push/onesignal/OneSignalSDKWorker.js',location.href).href;
      const res=await fetch(swUrl,{cache:'no-store'});
      const txt=await res.text();
      add('Fetch OneSignalSDKWorker.js',{
        url:swUrl,
        status:res.status,
        ok:res.ok,
        firstLine:(txt.split(/\r?\n/)[0]||'').slice(0,180),
        containsOneSignal:txt.includes('OneSignalSDK.sw.js')
      });
    }catch(err){
      addError('Fetch OneSignalSDKWorker.js ERRO',err);
    }

    // OneSignal SDK
    const OneSignal=window.PandasOneSignal;
    add('window.PandasOneSignal',!!OneSignal);

    if(!OneSignal){
      add('OneSignal','NÃO CARREGADO');
      return;
    }

    try{
      add('OneSignal.Notifications.permission',
        OneSignal.Notifications.permission);
    }catch(err){
      addError('Ler OneSignal.Notifications.permission ERRO',err);
    }

    try{
      add('OneSignal PushSubscription ANTES',{
        optedIn:OneSignal.User.PushSubscription.optedIn,
        id:OneSignal.User.PushSubscription.id||null,
        token:OneSignal.User.PushSubscription.token ? 'PRESENTE' : null
      });
    }catch(err){
      addError('Ler PushSubscription ANTES ERRO',err);
    }

    // Attempt real optIn and capture the actual error
    try{
      add('Executando OneSignal.User.PushSubscription.optIn()','INICIANDO');
      const result=await OneSignal.User.PushSubscription.optIn();
      add('optIn() retorno',result ?? 'undefined');
    }catch(err){
      addError('optIn() ERRO REAL',err);
    }

    await wait(2500);

    try{
      add('OneSignal PushSubscription DEPOIS',{
        optedIn:OneSignal.User.PushSubscription.optedIn,
        id:OneSignal.User.PushSubscription.id||null,
        token:OneSignal.User.PushSubscription.token ? 'PRESENTE' : null
      });
    }catch(err){
      addError('Ler PushSubscription DEPOIS ERRO',err);
    }

    try{
      const nativeSub2=await reg.pushManager.getSubscription();
      add('PushManager depois do optIn',nativeSub2 ? {
        endpoint:nativeSub2.endpoint,
        expirationTime:nativeSub2.expirationTime,
        hasP256dh:!!nativeSub2.getKey('p256dh'),
        hasAuth:!!nativeSub2.getKey('auth')
      } : 'NULL');
    }catch(err){
      addError('PushManager depois do optIn ERRO',err);
    }

    // Final high-level verdict
    let finalId='';
    try{ finalId=OneSignal.User.PushSubscription.id||''; }catch{}
    if(finalId){
      add('RESULTADO FINAL','✅ Subscription ID criado com sucesso');
    }else{
      add('RESULTADO FINAL','❌ Ainda sem Subscription ID. Copie este diagnóstico e envie.');
    }

  }catch(err){
    addError('ERRO GERAL DO TESTE',err);
  }finally{
    if(btn){
      btn.disabled=false;
      btn.textContent='🧪 Executar teste técnico';
    }
  }
}

document.getElementById('runTechnicalPushTest')?.addEventListener('click',runTechnicalPushTest);

document.getElementById('copyTechnicalPushTest')?.addEventListener('click',async()=>{
  const txt=document.getElementById('technicalPushOutput')?.textContent||'';
  try{
    await navigator.clipboard.writeText(txt);
    toast('Diagnóstico copiado.');
  }catch{
    alert(txt);
  }
});

/* Mantido apenas como fallback visual quando o aplicativo estiver aberto.
   As notificações em segundo plano passam a ser entregues pelo OneSignal. */
function checkTodayMatches(){
  // Não cria mais notificações locais duplicadas.
}

let deferredPrompt=null;

function isRunningInstalled(){
  return window.matchMedia('(display-mode: standalone)').matches ||
         window.matchMedia('(display-mode: fullscreen)').matches ||
         window.navigator.standalone === true;
}

function setInstallButtonsVisible(visible){
  const b1=document.getElementById('installBtn');
  const b2=document.getElementById('installBtn2');
  if(b1) b1.style.display=visible ? '' : 'none';
  if(b2) b2.style.display=visible ? '' : 'none';
}

function updateInstallUI(){
  const installedFlag=localStorage.getItem('pandasfc_installed') === '1';

  if(isRunningInstalled() || installedFlag){
    setInstallButtonsVisible(false);
    return;
  }

  // Antes do beforeinstallprompt, mantém oculto para não exibir um botão sem ação.
  setInstallButtonsVisible(!!deferredPrompt);
}

window.addEventListener('beforeinstallprompt',e=>{
  e.preventDefault();
  deferredPrompt=e;
  updateInstallUI();
});

async function installApp(){
  if(isRunningInstalled()){
    localStorage.setItem('pandasfc_installed','1');
    setInstallButtonsVisible(false);
    return;
  }

  if(!deferredPrompt){
    alert('A instalação automática ainda não foi liberada pelo navegador. Aguarde alguns segundos ou use o menu ⋮ do Chrome → “Instalar app”.');
    return;
  }

  try{
    deferredPrompt.prompt();
    const result=await deferredPrompt.userChoice;

    if(result.outcome === 'accepted'){
      // Oculta imediatamente, sem esperar outra navegação.
      localStorage.setItem('pandasfc_installed','1');
      setInstallButtonsVisible(false);
      toast('Instalação iniciada.');
    }

    deferredPrompt=null;
    updateInstallUI();
  }catch(err){
    console.error('Erro ao instalar PWA:',err);
  }
}

document.getElementById('installBtn').onclick=installApp;
document.getElementById('installBtn2').onclick=installApp;

window.addEventListener('appinstalled',()=>{
  localStorage.setItem('pandasfc_installed','1');
  deferredPrompt=null;
  setInstallButtonsVisible(false);
  toast('PANDAS FC instalado com sucesso.');
});

// Se o app for aberto em modo standalone, garante que o botão nunca apareça.
window.matchMedia('(display-mode: standalone)').addEventListener?.('change',updateInstallUI);
updateInstallUI();

if('serviceWorker'in navigator){
  window.addEventListener('load',async()=>{
    try{
      await navigator.serviceWorker.register('./sw.js',{scope:'./'});
      await navigator.serviceWorker.ready;
      setTimeout(()=>refreshPushStatus().catch(()=>{}),500);
    }catch(err){
      console.error('Erro ao registrar sw.js:',err);
    }
  });
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
