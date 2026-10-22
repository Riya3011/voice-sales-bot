import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Activity, ArrowDownLeft, ArrowLeft, ArrowRight, AudioLines, Bot, CalendarClock, Check, ChevronDown, CircleHelp, Clock3, Download, Headphones, History, LayoutDashboard, Mic, MicOff, MoreHorizontal, Phone, PhoneCall, PhoneOff, Plus, Search, Settings2, ShieldCheck, Sparkles, Users, Volume2, WandSparkles, X } from 'lucide-react';
import './styles.css';

const rawApi = import.meta.env.VITE_API_URL || 'http://localhost:8787';
const API = rawApi.replace(/\/+$/, '');
const STATUSES = ['Converted', 'Interested', 'Follow-up Required', 'Not Interested', 'Demo Requested', 'No Response'];
const product = { name: 'CloudDesk', tagline: 'One calm workspace for your whole team.', description: 'CloudDesk is a fictional SaaS workspace for teams to organize projects, automate routine updates, and keep conversations in one place.', features: ['Project and task tracking', 'Automated team updates', 'Shared team workspace'], pricing: 'Demo pricing: plans start at ₹799 per user/month. This is sample data for the assignment.' };
const fmtDuration = (s=0) => `${Math.floor(s/60).toString().padStart(2,'0')}:${Math.floor(s%60).toString().padStart(2,'0')}`;
const fmtAudioTime = (sec = 0, forceHours = false) => {
  if (!Number.isFinite(sec) || sec < 0 || Number.isNaN(sec)) return forceHours ? '00:00:00' : '00:00';
  const total = Math.floor(sec);
  const hrs = Math.floor(total / 3600);
  const mins = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  const pad = (n) => n.toString().padStart(2, '0');
  if (hrs > 0 || forceHours) return `${pad(hrs)}:${pad(mins)}:${pad(secs)}`;
  return `${pad(mins)}:${pad(secs)}`;
};
const fmtDate = (v) => v ? new Date(v).toLocaleString([], { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' }) : '—';
const initials = (name='Guest customer') => name.split(' ').map(x=>x[0]).slice(0,2).join('').toUpperCase();

function App() {
  const [view, setView] = useState('overview');
  const [calls, setCalls] = useState([]);
  const [selected, setSelected] = useState(null);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('All calls');
  const [status, setStatus] = useState('Idle');
  const [isCallActive, setIsCallActive] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [transcript, setTranscript] = useState([]);
  const [customerName, setCustomerName] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(false);
  const [micMuted, setMicMuted] = useState(false);
  const [apiConfigured, setApiConfigured] = useState(false);
  const micRef = useRef(null); const recorderRef = useRef(null); const chunksRef = useRef([]); const startRef = useRef(null); const callIdRef = useRef(null); const transcriptRef = useRef([]); const secondsRef = useRef(0); const recognitionRef = useRef(null); const speakingRef = useRef(false); const busyRef = useRef(false); const chatHistoryRef = useRef([]); const activeRef = useRef(false);

  const refreshCalls = async () => { try { const r = await fetch(`${API}/api/calls`); const d = await r.json(); if (r.ok) setCalls(d.calls || []); } catch { setError('Cannot reach the local API. Start the backend with npm run dev.'); } };
  useEffect(() => { refreshCalls(); fetch(`${API}/api/health`).then(r=>r.json()).then(d=>setApiConfigured(d.configured)).catch(()=>{}); }, []);
  useEffect(() => {
    return () => {
      try { window.speechSynthesis?.cancel(); } catch {}
      try { recognitionRef.current?.stop(); } catch {}
      try { recorderRef.current?.stop(); } catch {}
      try { micRef.current?.getTracks().forEach(t => t.stop()); } catch {}
    };
  }, []);
  useEffect(() => { transcriptRef.current = transcript; }, [transcript]);
  useEffect(() => { secondsRef.current = seconds; }, [seconds]);
  useEffect(() => { if (!isCallActive) return; const t = setInterval(()=>setSeconds(s=>s+1),1000); return ()=>clearInterval(t); }, [isCallActive]);

  const addMessage = (role, text) => { if (!text?.trim()) return; const message={ id: `${Date.now()}-${Math.random()}`, role, text: text.trim(), at: new Date().toISOString() }; transcriptRef.current=[...transcriptRef.current,message]; setTranscript(transcriptRef.current); };


  const speak = (text) => new Promise(resolve => {
    if (!('speechSynthesis' in window)) { resolve(); return; }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = /[\u0900-\u097F]/.test(text) ? 'hi-IN' : 'en-IN';
    utterance.rate = 1;
    utterance.onstart = () => { speakingRef.current = true; setStatus('Speaking'); try { recognitionRef.current?.stop(); } catch {} };
    utterance.onend = () => { speakingRef.current = false; busyRef.current=false; if (activeRef.current) { setStatus('Listening'); try { recognitionRef.current?.start(); } catch {} } resolve(); };
    utterance.onerror = () => { speakingRef.current = false; busyRef.current=false; if (activeRef.current) { setStatus('Listening'); try { recognitionRef.current?.start(); } catch {} } resolve(); };
    window.speechSynthesis.speak(utterance);
  });

  const getAIReply = async (history) => {
    const r = await fetch(`${API}/api/chat`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ messages:history, product }) });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'Could not generate an AI response.');
    return data.reply;
  };

  const startCall = async () => {
    setError(''); setNotice(''); setTranscript([]); transcriptRef.current=[]; chatHistoryRef.current=[]; busyRef.current=false; speakingRef.current=false; setSeconds(0); setLoading(true);
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Recognition) { setLoading(false); setError('Speech recognition is not supported in this browser. Please use the latest Google Chrome or Microsoft Edge.'); return; }
    const consent = window.confirm('Recording consent\n\nThis demo will record microphone audio and save the conversation transcript for review. AI replies are spoken aloud but may not be included in the audio recording on every browser. Continue only if you consent.');
    if (!consent) { setLoading(false); setNotice('Call not started because recording consent was not granted.'); return; }
    try {
      const mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation:true, noiseSuppression:true, autoGainControl:true } }); micRef.current = mic;
      chunksRef.current=[];
      const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm';
      const recorder = new MediaRecorder(mic, { mimeType:mime }); recorderRef.current=recorder;
      recorder.ondataavailable=e=>{ if(e.data?.size) chunksRef.current.push(e.data); }; recorder.start(1000);
      const recognition = new Recognition(); recognitionRef.current=recognition; recognition.continuous=true; recognition.interimResults=false; recognition.lang='en-IN';
      recognition.onresult = async (event) => {
        const result = event.results[event.results.length-1]; if (!result?.isFinal || speakingRef.current || busyRef.current || !activeRef.current) return;
        const text = result[0]?.transcript?.trim(); if (!text) return;
        const userMessage={role:'user',content:text}; chatHistoryRef.current=[...chatHistoryRef.current,userMessage].slice(-14);
        busyRef.current=true; try { recognition.stop(); } catch {} addMessage('customer',text); setStatus('Thinking');
        try {
          const reply=await getAIReply(chatHistoryRef.current);
          chatHistoryRef.current=[...chatHistoryRef.current,{role:'assistant',content:reply}].slice(-14);
          addMessage('assistant',reply); await speak(reply);
        } catch(e) { busyRef.current=false; setError(e.message); setStatus('Listening'); try { recognition.start(); } catch {} }
      };
      recognition.onerror = (event) => { if (event.error==='not-allowed' || event.error==='service-not-allowed') setError('Microphone or speech recognition permission was denied. Allow microphone access and retry.'); };
      recognition.onend = () => { if (activeRef.current && !speakingRef.current && !busyRef.current) { try { recognition.start(); } catch {} } };
      callIdRef.current=crypto.randomUUID(); startRef.current=new Date().toISOString(); activeRef.current=true; setIsCallActive(true); setStatus('Connecting'); setView('live');
      try { recognition.start(); } catch {}
      const greeting = await getAIReply([{ role:'user', content:`Start the sales call. Greet the customer as VoxPilot for ${product.name}, briefly explain why you are calling, and ask one simple discovery question. Do not assume they have agreed to anything.` }]);
      chatHistoryRef.current=[{role:'assistant',content:greeting}]; addMessage('assistant',greeting); setStatus('Speaking'); await speak(greeting);
    } catch(e) { activeRef.current=false; try { recognitionRef.current?.stop(); } catch {} try { recorderRef.current?.stop(); } catch {} micRef.current?.getTracks().forEach(t=>t.stop()); setIsCallActive(false); setStatus('Idle'); setError(e.message || 'Could not start the call. Check your browser permissions and Groq configuration.'); }
    finally { setLoading(false); }
  };

  const endCall = async () => {
    setLoading(true); setStatus('Ending call'); activeRef.current=false; busyRef.current=false; window.speechSynthesis?.cancel();
    try { recognitionRef.current?.stop(); } catch {}
    const id=callIdRef.current || crypto.randomUUID(); const endedAt=new Date().toISOString();
    let recordingBlob=null;
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      recordingBlob=await new Promise(resolve=>{ const rec=recorderRef.current; rec.addEventListener('stop',()=>resolve(new Blob(chunksRef.current,{type:rec.mimeType||'audio/webm'})),{once:true}); rec.stop(); });
    } else if (chunksRef.current.length) recordingBlob=new Blob(chunksRef.current,{type:'audio/webm'});
    recorderRef.current=null; micRef.current?.getTracks().forEach(t=>t.stop()); micRef.current=null; recognitionRef.current=null;
    let recordingUrl=null;
    try {
      if (recordingBlob?.size) { const form=new FormData(); form.append('recording',recordingBlob,'call.webm'); const uploadRes=await fetch(`${API}/api/calls/${id}/recording`,{method:'POST',body:form}); if(uploadRes.ok) recordingUrl=(await uploadRes.json()).recordingUrl; }
      const payload={id,startedAt:startRef.current,endedAt,durationSeconds:secondsRef.current,transcript:transcriptRef.current,customerName:customerName||'Guest customer',productName:product.name,recordingUrl};
      const r=await fetch(`${API}/api/calls`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)}); const d=await r.json(); if(!r.ok) throw new Error(d.error||'Could not save call.');
      setSelected(d.call); setNotice(recordingUrl?'Call saved with microphone recording, transcript, and AI analysis.':'Call saved, but audio recording was unavailable.'); await refreshCalls();
    } catch(e) { setError(`Call ended, but saving failed: ${e.message}`); }
    setStatus('Ended'); setIsCallActive(false); setLoading(false); setView('detail');
  };

  const toggleMute = () => { const next=!micMuted; micRef.current?.getAudioTracks().forEach(t=>t.enabled=!next); setMicMuted(next); };
  const deleteCall = async (id) => { if(!window.confirm('Delete this call and its recording?')) return; await fetch(`${API}/api/calls/${id}`,{method:'DELETE'}); setSelected(null); await refreshCalls(); setView('history'); };
  const filteredCalls = useMemo(()=>calls.filter(c=>(filter==='All calls'||c.status===filter)&&`${c.customerName} ${c.productName} ${c.summary} ${c.status}`.toLowerCase().includes(query.toLowerCase())),[calls,filter,query]);
  const stats = useMemo(()=>({ total:calls.length, interested:calls.filter(c=>['Interested','Demo Requested'].includes(c.status)).length, converted:calls.filter(c=>c.status==='Converted').length, followup:calls.filter(c=>c.status==='Follow-up Required').length }),[calls]);

  const handleNewCall = () => {
    if (isCallActive) {
      try { window.speechSynthesis?.cancel(); } catch {}
      try { recognitionRef.current?.stop(); } catch {}
      try { recorderRef.current?.stop(); } catch {}
      try { micRef.current?.getTracks().forEach(t=>t.stop()); } catch {}
      recorderRef.current = null;
      micRef.current = null;
      recognitionRef.current = null;
      activeRef.current = false;
      setIsCallActive(false);
    }
    setTranscript([]);
    transcriptRef.current = [];
    chatHistoryRef.current = [];
    setCustomerName('');
    setSeconds(0);
    setStatus('Idle');
    setError('');
    setView('live');
  };

  const updateSelectedCall = (updated) => {
    setSelected(updated);
    setCalls(prev => prev.map(c => c.id === updated.id ? updated : c));
    setNotice('Call analysis updated successfully with Groq AI.');
  };

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><div className="brand-mark"><AudioLines size={21}/></div><div><b>voxpilot</b><span>AI SALES STUDIO</span></div></div>
      <div className="workspace-label">WORKSPACE <ChevronDown size={13}/></div>
      <div className="workspace"><div className="workspace-avatar">S</div><div><strong>Sankar Group</strong><span>Sales workspace</span></div><MoreHorizontal size={18} className="muted-icon"/></div>
      <div className="nav-label">GENERAL</div>
      <button className={`nav-item ${view==='overview'?'active':''}`} onClick={()=>setView('overview')}><LayoutDashboard size={18}/> Overview</button>
      <button className={`nav-item ${view==='history'?'active':''}`} onClick={()=>setView('history')}><History size={18}/> Call history <span className="nav-count">{calls.length}</span></button>
      <button className={`nav-item ${view==='live'?'active':''}`} onClick={()=>isCallActive?setView('live'):handleNewCall()}><PhoneCall size={18}/> Live call</button>
      <div className="nav-label tools-label">TOOLS</div>
      <button className="nav-item" onClick={()=>setNotice('Product settings are currently configured in client/src/main.jsx. Edit the sample CloudDesk details there.')}><Settings2 size={18}/> Agent settings</button>
      <button className="nav-item" onClick={()=>setNotice('VoxPilot uses a temporary voice token from the backend. Your permanent API key is never sent to the browser.')}><ShieldCheck size={18}/> Privacy & security</button>
      <div className="sidebar-bottom"><div className="profile-row"><div className="profile-avatar">RG</div><div><b>Riya Gupta</b><span>Project admin</span></div><MoreHorizontal size={18} className="muted-icon"/></div></div>
    </aside>
    <main className="main-area">
      <header className="topbar"><div className="breadcrumb">Workspace <span>/</span> <b>{view==='overview'?'Overview':view==='history'?'Call history':view==='live'?'Live call':'Call details'}</b></div><div className="top-actions"><div className={`api-pill ${apiConfigured?'ready':''}`}><span className="dot"/>{apiConfigured?'Voice API configured':'Voice API not configured'}</div><button className="icon-button" title="Help" onClick={()=>setNotice('Need setup help? Open README.md in the project folder.')}><CircleHelp size={18}/></button><div className="top-avatar">RG</div></div></header>
      <div className="content-area">
        {error && <div className="alert error-alert"><X size={17}/><span>{error}</span><button onClick={()=>setError('')}><X size={16}/></button></div>}
        {notice && <div className="alert notice-alert"><Check size={17}/><span>{notice}</span><button onClick={()=>setNotice('')}><X size={16}/></button></div>}
        {view==='overview' && <>
          <div className="page-heading"><div><div className="eyebrow"><Sparkles size={13}/> SALES INTELLIGENCE</div><h1>Good evening, Riya <span className="wave">✳</span></h1><p>Turn conversations into meaningful customer relationships.</p></div><button className="primary-button" onClick={handleNewCall}><Plus size={17}/> New sales call <ArrowRight size={16}/></button></div>
          <div className="hero-card"><div className="hero-copy"><div className="hero-chip"><span className="live-dot"/> YOUR AI SALES ASSISTANT</div><h2>Every conversation.<br/><em>A smarter next step.</em></h2><p>Let VoxPilot discover customer needs, answer questions, and surface the next best sales action — while you focus on closing.</p><button className="hero-button" onClick={handleNewCall}><Phone size={16}/> Start a voice call <ArrowRight size={16}/></button><div className="hero-meta"><ShieldCheck size={14}/> Consent-first recording <span/> <AudioLines size={14}/> Real-time voice AI</div></div><div className="hero-visual"><div className="orbit orbit-one"/><div className="orbit orbit-two"/><div className="orb-core"><AudioLines size={42}/></div><div className="float-card float-card-top"><span className="float-icon purple"><WandSparkles size={15}/></span><div><b>AI-powered</b><small>Conversation insights</small></div><Check size={15} className="success-icon"/></div><div className="float-card float-card-bottom"><span className="float-icon green"><Activity size={16}/></span><div><b>Next best action</b><small>Personalized follow-up</small></div><ArrowDownLeft size={16} className="accent-icon"/></div><div className="tiny-spark spark-a">✦</div><div className="tiny-spark spark-b">✧</div></div></div>
          <div className="section-heading"><div><h2>Performance overview</h2><p>A snapshot of your sales conversations</p></div><span className="period-label"><CalendarClock size={14}/> All time</span></div>
          <div className="stats-grid"><StatCard label="Total conversations" value={stats.total} sub="All recorded calls" icon={<PhoneCall size={18}/>} color="violet"/><StatCard label="Interested leads" value={stats.interested} sub="Interested + demos" icon={<Users size={18}/>} color="blue"/><StatCard label="Demos requested" value={calls.filter(c=>c.status==='Demo Requested').length} sub="Ready for a walkthrough" icon={<CalendarClock size={18}/>} color="amber"/><StatCard label="Conversions" value={stats.converted} sub="Confirmed outcomes only" icon={<Check size={18}/>} color="green"/></div>
          <div className="bottom-grid"><section className="panel recent-panel"><div className="panel-header"><div><h3>Recent conversations</h3><p>Pick up where your team left off</p></div><button className="text-button" onClick={()=>setView('history')}>View all <ArrowRight size={15}/></button></div>{calls.length===0?<EmptyState compact title="No conversations yet" text="Start your first live call to see the conversation appear here." action="Start a call" onAction={handleNewCall}/>:<div className="recent-list">{calls.slice(0,5).map(c=><CallRow key={c.id} call={c} onClick={()=>{setSelected(c);setView('detail');}}/>)}</div>}</section><section className="panel agent-panel"><div className="panel-header"><div><h3>Your sales agent</h3><p>Currently selected assistant</p></div><button className="more-button" onClick={()=>setNotice('Agent configuration is in client/src/main.jsx for this prototype.')}><MoreHorizontal size={19}/></button></div><div className="agent-profile"><div className="agent-avatar"><Bot size={28}/><span className="agent-online"/></div><div><h4>VoxPilot</h4><p>AI sales representative</p><div className="agent-tags"><span><span className="dot green-dot"/> Ready to call</span><span>EN · HI</span></div></div></div><div className="agent-divider"/><div className="agent-detail"><span>Product</span><b>{product.name} <span className="demo-tag">DEMO</span></b></div><div className="agent-detail"><span>Conversation style</span><b>Consultative & friendly</b></div><div className="agent-detail"><span>Voice mode</span><b><AudioLines size={14}/> Real-time conversation</b></div><button className="outline-full" onClick={handleNewCall}><Phone size={15}/> Start conversation <ArrowRight size={15}/></button></section></div>
        </>}
        {view==='live' && <LiveCall active={isCallActive} loading={loading} status={status} seconds={seconds} transcript={transcript} customerName={customerName} setCustomerName={setCustomerName} onStart={startCall} onEnd={endCall} onMute={toggleMute} muted={micMuted} onBack={()=>setView('overview')} />}
        {view==='history' && <><div className="page-heading"><div><div className="eyebrow"><History size={13}/> CONVERSATION LOG</div><h1>Call history</h1><p>Every conversation, insight, and next step in one place.</p></div><button className="primary-button" onClick={handleNewCall}><Plus size={17}/> New sales call</button></div><div className="panel history-panel"><div className="history-toolbar"><div className="search-box"><Search size={17}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search conversations..."/></div><select value={filter} onChange={e=>setFilter(e.target.value)}><option>All calls</option>{STATUSES.map(s=><option key={s}>{s}</option>)}</select><button className="outline-button" onClick={refreshCalls}><Activity size={15}/> Refresh</button></div><div className="table-wrap"><table><thead><tr><th>CONTACT</th><th>DATE & TIME</th><th>DURATION</th><th>SALES STATUS</th><th>SUMMARY</th><th></th></tr></thead><tbody>{filteredCalls.map(c=><tr key={c.id} onClick={()=>{setSelected(c);setView('detail');}}><td><div className="contact-cell"><div className="contact-avatar">{initials(c.customerName)}</div><div><b>{c.customerName||'Guest customer'}</b><small>{c.productName||product.name}</small></div></div></td><td>{fmtDate(c.startedAt)}</td><td><span className="duration-cell"><Clock3 size={13}/>{fmtDuration(c.durationSeconds)}</span></td><td><StatusBadge status={c.status}/></td><td className="summary-cell">{c.summary||'No summary available'}</td><td><button className="row-open" onClick={e=>{e.stopPropagation();setSelected(c);setView('detail');}}><ArrowRight size={16}/></button></td></tr>)}</tbody></table>{filteredCalls.length===0&&<EmptyState title="Nothing to show yet" text={query||filter!=='All calls'?'Try another search or filter.':'Your saved calls will appear here after your first conversation.'} action="Start a call" onAction={handleNewCall}/>}</div></div></>}
        {view==='detail' && selected && <CallDetail call={selected} onBack={()=>setView('history')} onDelete={()=>deleteCall(selected.id)} onRefresh={refreshCalls} onNewCall={handleNewCall} onUpdateCall={updateSelectedCall}/>}
      </div>
      <footer className="footer"><span>© 2026 VoxPilot · Sankar Group assignment</span><span><span className="footer-dot"/> Built for better conversations</span></footer>
    </main>
  </div>;
}

function StatCard({label,value,sub,icon,color}) { return <div className="stat-card"><div className="stat-top"><span>{label}</span><div className={`stat-icon ${color}`}>{icon}</div></div><div className="stat-value">{value}</div><div className="stat-sub">{sub}</div></div>; }
function StatusBadge({status}) { const map={'Converted':'converted','Interested':'interested','Follow-up Required':'followup','Not Interested':'notinterested','Demo Requested':'demo','No Response':'noresponse'}; return <span className={`status-badge ${map[status]||'noresponse'}`}><span/>{status||'No Response'}</span>; }
function CallRow({call,onClick}) { return <button className="recent-row" onClick={onClick}><div className="contact-avatar">{initials(call.customerName)}</div><div className="recent-main"><b>{call.customerName||'Guest customer'}</b><small>{fmtDate(call.startedAt)}</small></div><StatusBadge status={call.status}/><span className="recent-duration">{fmtDuration(call.durationSeconds)}</span><ArrowRight size={15} className="row-arrow"/></button>; }
function EmptyState({title,text,action,onAction,compact=false}) { return <div className={`empty-state ${compact?'compact':''}`}><div className="empty-icon"><Headphones size={22}/></div><h4>{title}</h4><p>{text}</p>{action&&<button className="text-button" onClick={onAction}>{action} <ArrowRight size={14}/></button>}</div>; }

function LiveCall({active,loading,status,seconds,transcript,customerName,setCustomerName,onStart,onEnd,onMute,muted,onBack}) {
  const listRef=useRef(null); useEffect(()=>{if(listRef.current)listRef.current.scrollTop=listRef.current.scrollHeight;},[transcript]);
  return <><div className="page-heading live-heading"><div><button className="back-link" onClick={onBack}><ArrowLeft size={15}/> Back to overview</button><div className="eyebrow"><span className={active?'live-dot':'dot'}/> LIVE CONVERSATION</div><h1>AI sales call</h1><p>Talk naturally. VoxPilot will listen, respond, and capture the conversation.</p></div><div className={`call-status-pill ${active?'active':''}`}><span className="dot"/>{loading?'Connecting…':active?status:'Ready to connect'}</div></div>
    <div className="call-layout"><section className="panel call-center"><div className="call-center-top"><div><span className="small-overline">VOICE SESSION</span><h3>{active?'Conversation in progress':'Ready when you are'}</h3><p>{active?'Speak normally — the AI will respond in real time.':'Start a live session with your AI sales representative.'}</p></div><div className="timer-box"><Clock3 size={15}/><b>{fmtDuration(seconds)}</b></div></div>
      {!active?<div className="precall"><div className="voice-orb idle-orb"><AudioLines size={42}/><span className="orb-ping"/></div><h2>Meet your AI sales assistant</h2><p>VoxPilot can discover customer needs, explain CloudDesk, answer questions, and suggest a next step.</p><div className="customer-input"><label>Customer name <span>OPTIONAL</span></label><input value={customerName} onChange={e=>setCustomerName(e.target.value)} placeholder="e.g. Alex from Acme"/></div><div className="consent-note"><ShieldCheck size={16}/><span>Recording consent is requested before the call starts. Microphone audio is recorded; both sides of the conversation are saved in the transcript.</span></div><button className="primary-button start-large" onClick={onStart} disabled={loading}><PhoneCall size={17}/>{loading?'Connecting to voice service…':'Start live call'} <ArrowRight size={16}/></button><div className="precall-foot"><span><Mic size={14}/> Microphone required</span><span><Sparkles size={14}/> English & Hindi</span></div></div>:<><div className="live-agent-stage"><div className="voice-orb live-orb"><AudioLines size={42}/><span className="sound-ring ring-a"/><span className="sound-ring ring-b"/></div><h2>{status==='Speaking'?'VoxPilot is speaking':'Listening to you'}</h2><p>{status==='Speaking'?'Your AI sales assistant is responding.':'Go ahead — tell the assistant what your team needs.'}</p><div className="wave-bars">{Array.from({length:29},(_,i)=><span key={i} style={{'--i':i}}/>)}</div></div><div className="call-controls"><button className={`control-button ${muted?'muted':''}`} onClick={onMute}>{muted?<MicOff size={19}/>:<Mic size={19}/>}<span>{muted?'Unmute':'Mute'}</span></button><div className="recording-indicator"><span className="recording-dot"/> Recording with consent</div><button className="end-call-button" onClick={onEnd} disabled={loading}><PhoneOff size={18}/>{loading?'Saving call…':'End call'}</button></div></>}
      </section><section className="panel transcript-panel"><div className="panel-header transcript-header"><div><h3><span className="transcript-live-icon"><AudioLines size={15}/></span> Live transcript</h3><p>{transcript.length} messages captured</p></div><span className="transcript-live-tag">{active?'LIVE':'PREVIEW'}</span></div><div className="transcript-messages" ref={listRef}>{transcript.length===0?<div className="transcript-empty"><div className="transcript-empty-icon"><Volume2 size={20}/></div><b>Your conversation will appear here</b><p>Customer speech and AI responses will show up as text in real time.</p></div>:transcript.map((m,i)=><div className={`message ${m.role==='customer'?'customer-message':'assistant-message'}`} key={m.id||i}><div className={`message-avatar ${m.role==='customer'?'customer-av':'assistant-av'}`}>{m.role==='customer'?initials(customerName||'Customer'):<AudioLines size={16}/>}</div><div className="message-body"><div className="message-meta"><b>{m.role==='customer'?(customerName||'Customer'):'VoxPilot'}</b><time>{new Date(m.at||Date.now()).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}</time></div><p>{m.text}</p></div></div>)}</div><div className="transcript-footer"><span><ShieldCheck size={14}/> Conversation is private to this demo workspace.</span><span className={active?'transcript-connected':''}><span className="dot"/>{active?'Connected':'Not connected'}</span></div></section></div>
    <div className="call-tip"><Sparkles size={16}/><div><b>Pro tip</b><span>Try asking about pricing, team collaboration, or how CloudDesk could help reduce manual status updates.</span></div></div>
  </>;
}

function RecordingPlayer({ src, fallbackDuration = 0 }) {
  const audioRef = useRef(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(
    Number.isFinite(Number(fallbackDuration)) && Number(fallbackDuration) > 0 ? Number(fallbackDuration) : 0
  );

  useEffect(() => {
    setCurrentTime(0);
    const initial = Number.isFinite(Number(fallbackDuration)) && Number(fallbackDuration) > 0 ? Number(fallbackDuration) : 0;
    setDuration(initial);
  }, [src, fallbackDuration]);

  const updateDuration = (el) => {
    if (!el) return;
    const d = el.duration;
    if (Number.isFinite(d) && d > 0) {
      setDuration(d);
    } else if (d === Infinity) {
      const onSeeked = () => {
        el.removeEventListener('seeked', onSeeked);
        if (Number.isFinite(el.duration) && el.duration > 0) {
          setDuration(el.duration);
        }
        el.currentTime = 0;
      };
      el.addEventListener('seeked', onSeeked);
      el.currentTime = 1e10;
    } else if (Number.isFinite(Number(fallbackDuration)) && Number(fallbackDuration) > 0) {
      setDuration(Number(fallbackDuration));
    }
  };

  const handleLoadedMetadata = (e) => updateDuration(e.currentTarget);
  const handleDurationChange = (e) => updateDuration(e.currentTarget);
  const handleTimeUpdate = (e) => setCurrentTime(e.currentTarget.currentTime || 0);
  const handleSeeking = (e) => setCurrentTime(e.currentTarget.currentTime || 0);
  const handleSeeked = (e) => setCurrentTime(e.currentTarget.currentTime || 0);
  const handleEnded = (e) => {
    const el = e.currentTarget;
    setCurrentTime(Number.isFinite(el.duration) && el.duration > 0 ? el.duration : duration);
  };

  const showHours = duration >= 3600 || currentTime >= 3600;
  const elapsedFormatted = fmtAudioTime(currentTime, showHours);
  const totalFormatted = fmtAudioTime(duration, showHours);

  return (
    <div className="recording-player">
      <audio
        ref={audioRef}
        controls
        preload="metadata"
        src={src}
        onLoadedMetadata={handleLoadedMetadata}
        onDurationChange={handleDurationChange}
        onTimeUpdate={handleTimeUpdate}
        onSeeking={handleSeeking}
        onSeeked={handleSeeked}
        onEnded={handleEnded}
      />
      <div className="recording-time-display" aria-label="Playback time">
        <Clock3 size={13} />
        <span className="recording-time-text">{elapsedFormatted} / {totalFormatted}</span>
      </div>
    </div>
  );
}

function CallDetail({call,onBack,onDelete,onNewCall,onUpdateCall}) {
  const [analyzing, setAnalyzing] = useState(false);
  const [reanalyzeError, setReanalyzeError] = useState('');

  const handleReanalyze = async () => {
    setAnalyzing(true);
    setReanalyzeError('');
    try {
      const res = await fetch(`${API}/api/calls/${call.id}/analyze`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not re-analyze call.');
      if (data.call && onUpdateCall) onUpdateCall(data.call);
    } catch (e) {
      setReanalyzeError(e.message || 'Re-analysis failed.');
    } finally {
      setAnalyzing(false);
    }
  };

  return <><div className="page-heading detail-heading"><div><button className="back-link" onClick={onBack}><ArrowLeft size={15}/> Back to call history</button><div className="eyebrow"><Activity size={13}/> CONVERSATION INSIGHTS</div><h1>Call details</h1><p>{fmtDate(call.startedAt)} · {fmtDuration(call.durationSeconds)} · {call.customerName}</p></div><div className="detail-actions"><button className="primary-button" onClick={onNewCall}><Plus size={16}/> New Call</button><button className="outline-button" onClick={handleReanalyze} disabled={analyzing}><WandSparkles size={15}/> {analyzing ? 'Analyzing…' : 'Re-analyze AI'}</button><button className="outline-button" onClick={()=>window.print()}><Download size={15}/> Export / Print</button><button className="danger-button" onClick={onDelete}><X size={15}/> Delete call</button></div></div>
    {reanalyzeError && <div className="alert error-alert"><X size={17}/><span>{reanalyzeError}</span><button onClick={()=>setReanalyzeError('')}><X size={16}/></button></div>}
    <div className="detail-summary-grid"><div className="panel detail-summary-card"><div className="summary-card-head"><div className="summary-icon"><WandSparkles size={18}/></div><div><h3>AI call summary</h3><p>Generated from the conversation transcript</p></div><StatusBadge status={call.status}/></div><p className="summary-copy">{call.summary||'No summary was generated for this call.'}</p><div className="summary-subgrid"><div><span>Customer requirements</span>{call.requirements?.length?<ul>{call.requirements.map((x,i)=><li key={i}>{x}</li>)}</ul>:<p className="no-data">No requirements identified.</p>}</div><div><span>Objections raised</span>{call.objections?.length?<ul>{call.objections.map((x,i)=><li key={i}>{x}</li>)}</ul>:<p className="no-data">No objections recorded.</p>}</div></div><div className="next-steps"><div className="next-steps-title"><CalendarClock size={16}/><b>Recommended next steps</b></div>{call.nextSteps?.length?<ul>{call.nextSteps.map((x,i)=><li key={i}>{x}</li>)}</ul>:<p className="no-data">No next steps available.</p>}<div className="rationale"><b>Status rationale:</b> {call.rationale||'No rationale available.'}</div></div></div>
      <div className="detail-side"><div className="panel call-info-panel"><h3>Call information</h3><div className="info-line"><span>Contact</span><b>{call.customerName||'Guest customer'}</b></div><div className="info-line"><span>Product</span><b>{call.productName||product.name}</b></div><div className="info-line"><span>Date & time</span><b>{fmtDate(call.startedAt)}</b></div><div className="info-line"><span>Duration</span><b>{fmtDuration(call.durationSeconds)}</b></div><div className="info-line"><span>Sales status</span><StatusBadge status={call.status}/></div></div><div className="panel recording-panel"><div className="recording-icon"><Headphones size={20}/></div><h3>Call recording</h3><p>Replay the recorded microphone audio. The transcript includes both customer and AI messages.</p>{call.recordingUrl?<RecordingPlayer src={call.recordingUrl?.startsWith('http') ? call.recordingUrl : `${API}${call.recordingUrl}`} fallbackDuration={call.durationSeconds}/>:<div className="no-recording"><MicOff size={16}/> No recording available</div>}</div></div></div>
    <section className="panel detail-transcript"><div className="panel-header"><div><h3>Full transcript</h3><p>{call.transcript?.length||0} messages · chronological order</p></div><span className="transcript-live-tag">SAVED</span></div>{call.transcript?.length?<div className="saved-transcript">{call.transcript.map((m,i)=><div className="message" key={m.id||i}><div className={`message-avatar ${m.role==='customer'?'customer-av':'assistant-av'}`}>{m.role==='customer'?initials(call.customerName):<AudioLines size={16}/>}</div><div className="message-body"><div className="message-meta"><b>{m.role==='customer'?(call.customerName||'Customer'):'VoxPilot'}</b><time>{fmtDate(m.at)}</time></div><p>{m.text}</p></div></div>)}</div>:<EmptyState title="No transcript captured" text="This call did not contain transcript messages."/>}</section>
  </>; }

createRoot(document.getElementById('root')).render(<App/>);

