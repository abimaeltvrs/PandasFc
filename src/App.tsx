import { useMemo, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';
import {
  CalendarDays, ChartNoAxesCombined, CircleUserRound, ClipboardList, Cog,
  Goal, Home, Medal, Search, Shield, Swords, Trash2, Upload, UsersRound
} from 'lucide-react';

type Player = { id: string; name: string; position: string; number: string; goals: number };
type Match = {
  id: string; opponent: string; opponentLogo?: string; date: string; time: string; location: string;
  pandasGoals?: number; opponentGoals?: number;
};
type Screen = 'dashboard' | 'players' | 'squad' | 'lineup' | 'matches' | 'agenda' | 'stats' | 'scorers' | 'settings';

type PersistedState = { players: Player[]; matches: Match[]; teamLogo?: string; teamName: string };

const STORAGE_KEY = 'pandas-fc-state-v1';
const initialState: PersistedState = { players: [], matches: [], teamName: 'PANDAS FC' };

function loadState(): PersistedState {
  try { return { ...initialState, ...JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') }; }
  catch { return initialState; }
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function resultOf(m: Match) {
  if (m.pandasGoals == null || m.opponentGoals == null) return 'AGENDADA';
  if (m.pandasGoals > m.opponentGoals) return 'VITÓRIA';
  if (m.pandasGoals < m.opponentGoals) return 'DERROTA';
  return 'EMPATE';
}

function downloadCanvas(canvas: HTMLCanvasElement, name: string) {
  const a = document.createElement('a');
  a.href = canvas.toDataURL('image/png');
  a.download = name;
  a.click();
}

function drawImage(ctx: CanvasRenderingContext2D, src: string, x: number, y: number, w: number, h: number) {
  return new Promise<void>((resolve) => {
    const img = new Image();
    img.onload = () => { ctx.drawImage(img, x, y, w, h); resolve(); };
    img.onerror = () => resolve();
    img.src = src;
  });
}

function positionCoords(position: string, index: number, total: number) {
  const p = position.toLowerCase();
  if (p.includes('gol')) return { x: 50, y: 88 };
  if (p.includes('zag')) return { x: 35 + (index % 3) * 15, y: 70 };
  if (p.includes('lat')) return { x: index % 2 ? 82 : 18, y: 64 };
  if (p.includes('vol')) return { x: 50 + (index % 2 ? 15 : -15), y: 54 };
  if (p.includes('mei')) return { x: 30 + (index % 3) * 20, y: 42 };
  if (p.includes('pont')) return { x: index % 2 ? 80 : 20, y: 25 };
  if (p.includes('ata') || p.includes('cent')) return { x: 50 + ((index % 3) - 1) * 20, y: 18 };
  const angle = (index / Math.max(total, 1)) * Math.PI * 2;
  return { x: 50 + Math.cos(angle) * 28, y: 50 + Math.sin(angle) * 28 };
}

export default function App() {
  const [state, setStateRaw] = useState<PersistedState>(loadState);
  const [screen, setScreen] = useState<Screen>('dashboard');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string[]>([]);

  const setState = (next: PersistedState | ((s: PersistedState) => PersistedState)) => {
    setStateRaw(prev => {
      const value = typeof next === 'function' ? next(prev) : next;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
      return value;
    });
  };

  const nav = [
    ['dashboard', Home, 'Início / Dashboard'], ['players', CircleUserRound, 'Cadastro de Jogadores'],
    ['squad', UsersRound, 'Elenco'], ['lineup', Goal, 'Escalação'], ['matches', Swords, 'Partidas'],
    ['agenda', CalendarDays, 'Agenda'], ['stats', ChartNoAxesCombined, 'Estatísticas'],
    ['scorers', Medal, 'Artilharia'], ['settings', Cog, 'Configurações'],
  ] as const;

  const savePlayer = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const player: Player = {
      id: crypto.randomUUID(), name: String(fd.get('name') || '').trim(),
      position: String(fd.get('position') || '').trim(), number: String(fd.get('number') || '').trim(), goals: 0,
    };
    if (!player.name || !player.position || !player.number) return;
    setState(s => ({ ...s, players: [...s.players, player] }));
    e.currentTarget.reset();
  };

  const saveMatch = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const logoFile = fd.get('logo') as File;
    const opponentLogo = logoFile?.size ? await fileToDataUrl(logoFile) : undefined;
    const m: Match = {
      id: crypto.randomUUID(), opponent: String(fd.get('opponent') || '').trim(), opponentLogo,
      date: String(fd.get('date') || ''), time: String(fd.get('time') || ''), location: String(fd.get('location') || '').trim(),
    };
    if (!m.opponent || !m.date || !m.time) return;
    setState(s => ({ ...s, matches: [...s.matches, m].sort((a,b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`)) }));
    await scheduleReminder(m);
    e.currentTarget.reset();
  };

  async function scheduleReminder(m: Match) {
    if (!Capacitor.isNativePlatform()) return;
    let at = new Date(`${m.date}T09:00:00`);
    const kickoff = new Date(`${m.date}T${m.time}:00`);
    if (at.getTime() <= Date.now() && kickoff.getTime() > Date.now()) at = kickoff;
    if (at.getTime() <= Date.now()) return;
    try {
      await LocalNotifications.requestPermissions();
      await LocalNotifications.schedule({ notifications: [{
        id: Math.abs(hashCode(m.id)), title: '⚽ Hoje tem PANDAS FC!',
        body: `PANDAS FC x ${m.opponent} • ${m.time}${m.location ? ` • ${m.location}` : ''}`,
        schedule: { at, allowWhileIdle: true },
      }] });
    } catch (err) { console.warn('Não foi possível agendar a notificação', err); }
  }

  const filteredPlayers = useMemo(() => state.players.filter(p =>
    `${p.name} ${p.position} ${p.number}`.toLowerCase().includes(query.toLowerCase())), [state.players, query]);

  async function generateLineup() {
    const canvas = document.createElement('canvas'); canvas.width = 1080; canvas.height = 1350;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#07140d'; ctx.fillRect(0,0,1080,1350);
    ctx.fillStyle = '#f5f7f5'; ctx.font = 'bold 64px Arial'; ctx.textAlign = 'center'; ctx.fillText('PANDAS FC',540,90);
    ctx.font = 'bold 42px Arial'; ctx.fillText('ESCALAÇÃO DO DIA',540,145);
    const left=100, top=200, w=880, h=1050;
    ctx.fillStyle='#126b35'; ctx.fillRect(left,top,w,h); ctx.strokeStyle='#fff'; ctx.lineWidth=8; ctx.strokeRect(left,top,w,h);
    ctx.beginPath(); ctx.moveTo(left,top+h/2); ctx.lineTo(left+w,top+h/2); ctx.stroke();
    ctx.beginPath(); ctx.arc(left+w/2,top+h/2,110,0,Math.PI*2); ctx.stroke();
    const chosen = state.players.filter(p => selected.includes(p.id));
    chosen.forEach((p,i) => {
      const pos = positionCoords(p.position,i,chosen.length); const x=left+w*pos.x/100, y=top+h*pos.y/100;
      ctx.fillStyle='#080b10'; ctx.beginPath(); ctx.arc(x,y,48,0,Math.PI*2); ctx.fill(); ctx.strokeStyle='#fff'; ctx.lineWidth=4; ctx.stroke();
      ctx.fillStyle='#fff'; ctx.font='bold 30px Arial'; ctx.fillText(p.number,x,y+10);
      ctx.font='bold 25px Arial'; ctx.fillText(p.name.toUpperCase(),x,y+82);
    });
    if (state.teamLogo) await drawImage(ctx,state.teamLogo,30,25,110,110);
    downloadCanvas(canvas,'pandas-fc-escalacao.png');
  }

  async function generateMatchPoster(m: Match) {
    const canvas=document.createElement('canvas'); canvas.width=1080; canvas.height=1350; const ctx=canvas.getContext('2d')!;
    const grad=ctx.createLinearGradient(0,0,1080,1350); grad.addColorStop(0,'#050505'); grad.addColorStop(1,'#0e4f29'); ctx.fillStyle=grad; ctx.fillRect(0,0,1080,1350);
    ctx.fillStyle='#fff'; ctx.textAlign='center'; ctx.font='bold 56px Arial'; ctx.fillText('DIA DE JOGO',540,150);
    if(state.teamLogo) await drawImage(ctx,state.teamLogo,160,330,260,260); else {ctx.font='bold 40px Arial';ctx.fillText('PANDAS FC',290,470)}
    if(m.opponentLogo) await drawImage(ctx,m.opponentLogo,660,330,260,260); else {ctx.font='bold 40px Arial';ctx.fillText(m.opponent.toUpperCase(),790,470)}
    ctx.font='bold 90px Arial'; ctx.fillText('X',540,500);
    ctx.font='bold 42px Arial'; ctx.fillText('PANDAS FC',290,650); ctx.fillText(m.opponent.toUpperCase(),790,650);
    const d=new Date(`${m.date}T12:00:00`); ctx.font='bold 46px Arial'; ctx.fillText(d.toLocaleDateString('pt-BR'),540,825);
    ctx.font='bold 58px Arial'; ctx.fillText(m.time,540,910); ctx.font='36px Arial'; ctx.fillText(m.location || 'Local a definir',540,990);
    ctx.font='bold 34px Arial'; ctx.fillText('PANDAS FC',540,1190);
    downloadCanvas(canvas,`pandas-fc-${m.date}-${m.opponent.replace(/\s+/g,'-').toLowerCase()}.png`);
  }

  function content() {
    if(screen==='dashboard') return <section className="hero"><Logo state={state}/></section>;
    if(screen==='players') return <Panel title="Cadastro de Jogadores"><form className="form" onSubmit={savePlayer}><input name="name" placeholder="Nome do jogador"/><input name="position" placeholder="Posição (ex.: Atacante)"/><input name="number" placeholder="Número" inputMode="numeric"/><button>Cadastrar jogador</button></form></Panel>;
    if(screen==='squad') return <Panel title="Elenco"><div className="search"><Search size={18}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Pesquisar nome, posição ou número"/></div><div className="cards">{filteredPlayers.map(p=><div className="player-card" key={p.id}><b>#{p.number} {p.name}</b><span>{p.position}</span><button className="icon danger" onClick={()=>setState(s=>({...s,players:s.players.filter(x=>x.id!==p.id)}))}><Trash2 size={17}/></button></div>)}</div></Panel>;
    if(screen==='lineup') return <Panel title="Escalação"><div className="lineup-layout"><div className="pitch">{state.players.filter(p=>selected.includes(p.id)).map((p,i)=>{const pos=positionCoords(p.position,i,selected.length);return <div className="field-player" key={p.id} style={{left:`${pos.x}%`,top:`${pos.y}%`}}><i>{p.number}</i><small>{p.name}</small></div>})}</div><div><h3>Selecione os jogadores</h3>{state.players.map(p=><label className="check" key={p.id}><input type="checkbox" checked={selected.includes(p.id)} onChange={()=>setSelected(v=>v.includes(p.id)?v.filter(x=>x!==p.id):[...v,p.id])}/><span>#{p.number} {p.name} <small>({p.position})</small></span></label>)}<button onClick={generateLineup} disabled={!selected.length}>Gerar imagem da escalação</button></div></div></Panel>;
    if(screen==='agenda') return <Panel title="Agenda"><form className="form" onSubmit={saveMatch}><div className="fixed-team"><Shield/> Time A: <b>PANDAS FC</b></div><input name="opponent" placeholder="Nome do adversário"/><label className="file"><Upload size={18}/> Logo do adversário<input name="logo" type="file" accept="image/*"/></label><input name="date" type="date"/><input name="time" type="time"/><input name="location" placeholder="Local da partida"/><button>Agendar confronto</button></form><MatchList matches={state.matches} poster={generateMatchPoster}/></Panel>;
    if(screen==='matches') return <Panel title="Partidas"><div className="cards">{state.matches.map(m=><div className="match-card" key={m.id}><div><b>PANDAS FC</b> <span className="versus">X</span> <b>{m.opponent}</b><small>{new Date(`${m.date}T12:00:00`).toLocaleDateString('pt-BR')} • {m.time}</small></div><div className="score"><input type="number" min="0" value={m.pandasGoals ?? ''} placeholder="0" onChange={e=>updateScore(m.id,'pandasGoals',e.target.value)}/><b>x</b><input type="number" min="0" value={m.opponentGoals ?? ''} placeholder="0" onChange={e=>updateScore(m.id,'opponentGoals',e.target.value)}/></div><span className={`status ${resultOf(m).toLowerCase()}`}>{resultOf(m)}</span></div>)}</div></Panel>;
    if(screen==='stats') { const done=state.matches.filter(m=>m.pandasGoals!=null&&m.opponentGoals!=null); const wins=done.filter(m=>resultOf(m)==='VITÓRIA').length, draws=done.filter(m=>resultOf(m)==='EMPATE').length, losses=done.length-wins-draws; const gf=done.reduce((a,m)=>a+(m.pandasGoals||0),0), ga=done.reduce((a,m)=>a+(m.opponentGoals||0),0); return <Panel title="Estatísticas"><div className="stats-grid">{[['Jogos',done.length],['Vitórias',wins],['Empates',draws],['Derrotas',losses],['Gols marcados',gf],['Gols sofridos',ga],['Saldo',gf-ga],['Aproveitamento',done.length?`${Math.round(((wins*3+draws)/(done.length*3))*100)}%`:'0%']].map(([a,b])=><div className="stat" key={String(a)}><strong>{b}</strong><span>{a}</span></div>)}</div><h3>Histórico</h3><MatchList matches={done}/></Panel> }
    if(screen==='scorers') return <Panel title="Artilharia"><div className="ranking">{[...state.players].sort((a,b)=>b.goals-a.goals).map((p,i)=><div className="rank" key={p.id}><b>{i+1}º</b><span>#{p.number} {p.name}</span><div><button onClick={()=>goalDelta(p.id,-1)}>-</button><strong>{p.goals} gols</strong><button onClick={()=>goalDelta(p.id,1)}>+</button></div></div>)}</div></Panel>;
    return <Panel title="Configurações"><div className="form"><label>Nome do time<input value={state.teamName} onChange={e=>setState(s=>({...s,teamName:e.target.value}))}/></label><label className="file"><Upload size={18}/> Enviar logo do PANDAS FC<input type="file" accept="image/*" onChange={async e=>{const f=e.target.files?.[0];if(f){const logo=await fileToDataUrl(f);setState(s=>({...s,teamLogo:logo}))}}}/></label>{state.teamLogo&&<img className="logo-preview" src={state.teamLogo}/>}<button className="danger-btn" onClick={()=>{if(confirm('Apagar todos os dados do aplicativo?')){localStorage.removeItem(STORAGE_KEY);setStateRaw(initialState)}}}>Apagar todos os dados</button></div></Panel>;
  }

  function updateScore(id:string, key:'pandasGoals'|'opponentGoals', value:string){ setState(s=>({...s,matches:s.matches.map(m=>m.id===id?{...m,[key]:value===''?undefined:Number(value)}:m)})); }
  function goalDelta(id:string, delta:number){setState(s=>({...s,players:s.players.map(p=>p.id===id?{...p,goals:Math.max(0,p.goals+delta)}:p)}));}

  return <div className="app"><aside><div className="brand"><Logo state={state} compact/><span>PANDAS FC</span></div><nav>{nav.map(([id,Icon,label])=><button key={id} className={screen===id?'active':''} onClick={()=>setScreen(id)}><Icon size={20}/><span>{label}</span></button>)}</nav></aside><main>{content()}</main></div>;
}

function hashCode(s:string){let h=0;for(let i=0;i<s.length;i++)h=((h<<5)-h)+s.charCodeAt(i)|0;return h||1;}
function Panel({title,children}:{title:string,children:React.ReactNode}){return <section className="panel"><header><h1>{title}</h1></header>{children}</section>}
function Logo({state,compact=false}:{state:PersistedState,compact?:boolean}){return state.teamLogo?<img className={compact?'brand-logo':'main-logo'} src={state.teamLogo}/>:<div className={compact?'brand-placeholder':'logo-placeholder'}>🐼</div>}
function MatchList({matches,poster}:{matches:Match[],poster?:(m:Match)=>void}){return <div className="cards match-list">{matches.length===0&&<p className="empty">Nenhuma partida cadastrada.</p>}{matches.map(m=><div className="fixture" key={m.id}><div><b>PANDAS FC × {m.opponent}</b><small>{new Date(`${m.date}T12:00:00`).toLocaleDateString('pt-BR')} • {m.time} {m.location&&`• ${m.location}`}</small></div>{poster&&<button onClick={()=>poster(m)}>Gerar arte</button>}</div>)}</div>}
