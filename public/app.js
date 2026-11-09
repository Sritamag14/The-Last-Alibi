const $ = id => document.getElementById(id);
const entry = $('entry'), game = $('game'), notice = $('notice'), recovery = $('recovery'), connection = $('connection');
let credentials = null, state = null, stream = null, eventTimer = null, pollPending = false, lastRenderedPhase = null, notebookTimer = null, notebookDirty = false, viewingPhase = null, investigationFeedbackTimer = null, lastRenderedCaseId = null;
const NETLIFY_ENDPOINT = '/.netlify/functions/game';
const useNetlifyFunction = !(['localhost','127.0.0.1'].includes(location.hostname) && location.port !== '8888');
const saved = sessionStorage.getItem('lastAlibiSession');
if (saved) {
  try { credentials = JSON.parse(saved); reconnect(); }
  catch { sessionStorage.removeItem('lastAlibiSession'); credentials = null; }
}
async function request(path, extra = {}, includeCredentials = true) {
  const payload = { ...(includeCredentials ? (credentials || {}) : {}), ...extra };
  if (useNetlifyFunction) payload.action = path.replace(/^\/api\//, '');
  const response = await fetch(useNetlifyFunction ? NETLIFY_ENDPOINT : path, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(payload) });
  let result = {};
  try { result = await response.json(); } catch {}
  if (!response.ok) { const error = new Error(result.error?.message || 'That action could not be completed. Try again.'); error.status=response.status; error.code=result.error?.code; throw error; }
  return result;
}
async function post(path, extra = {}) { return request(path, extra, true); }
function showError(text) { notice.textContent=text||''; notice.classList.remove('success'); notice.classList.toggle('hidden',!text); }

function enter(result) {
  credentials = { code:result.code, playerId:result.playerId, token:result.token };
  sessionStorage.setItem('lastAlibiSession', JSON.stringify(credentials));
  entry.classList.add('hidden'); game.classList.remove('hidden'); recovery.classList.add('hidden'); showError('');
  connect();
  if (result.state) render(result.state);
}
async function reconnect() {
  try {
    const result = await post('/api/reconnect');
    entry.classList.add('hidden'); game.classList.remove('hidden'); render(result.state); connect();
  } catch (error) {
    sessionStorage.removeItem('lastAlibiSession');
    credentials = null;
    entry.classList.remove('hidden'); game.classList.add('hidden');
    recovery.textContent = error.message.includes('expired') || error.message.includes('not exist')
      ? 'Your old room is no longer running. Create a new room or enter a fresh room code below.'
      : 'Your saved session could not be restored. Rejoin with a room code or create a room.';
    recovery.classList.remove('hidden');
    showError(error.message);
  }
}
function connect() {
  if (stream) { stream.close(); stream=null; }
  clearInterval(eventTimer);
  if (!useNetlifyFunction) {
    const params = new URLSearchParams(credentials);
    stream = new EventSource('/api/events?' + params.toString());
    connection.textContent = 'Connecting…';
    stream.addEventListener('state', event => { try { render(JSON.parse(event.data)); connection.textContent='Live'; } catch { connection.textContent='Update issue'; } });
    stream.onopen = () => { connection.textContent='Live'; };
    stream.onerror = async () => {
      connection.textContent='Reconnecting…';
      if (!credentials) return;
      try { const result=await post('/api/reconnect'); render(result.state); }
      catch(error) { if(error.status===404||error.status===401) endSession(error.message); }
    };
    return;
  }
  connection.textContent='Connecting…';
  const poll=async()=>{
    if(pollPending||!credentials)return;
    pollPending=true;
    try { const result=await post('/api/state'); render(result.state); connection.textContent='Live'; }
    catch(error) { connection.textContent='Reconnecting…'; if(error.status===404||error.status===401) endSession(error.message); }
    finally { pollPending=false; }
  };
  poll();
  eventTimer=setInterval(poll,1500);
}
function endSession(message) {
  if(stream){stream.close();stream=null;} clearInterval(eventTimer);
  sessionStorage.removeItem('lastAlibiSession'); credentials=null; connection.textContent='Room ended';
  game.classList.add('hidden'); entry.classList.remove('hidden');
  recovery.textContent='That room is no longer running. Create a new room or enter a fresh room code below.'; recovery.classList.remove('hidden'); showError(message||'That room has expired. Create or join a fresh room.');
}
async function action(path, extra) {
  try {
    showError('');
    await post(path, extra);
    if(path==='/api/investigate')showInvestigationFeedback(({evidence:'Evidence added to the shared board.',timeline:'Timeline entry added to the shared board.',personal:'Your private lead is in your dossier.'})[extra?.kind]||'Investigation action recorded.');
    return true;
  }
  catch (e) { showError(e.message); return false; }
}
function showInvestigationFeedback(message){const feedback=$('investigation-feedback');if(!feedback)return;feedback.textContent=message;feedback.classList.remove('hidden');feedback.classList.add('is-saved');clearTimeout(investigationFeedbackTimer);investigationFeedbackTimer=setTimeout(()=>{const current=$('investigation-feedback');if(current){current.textContent='';current.classList.add('hidden');current.classList.remove('is-saved');}},2200);}
$('create').addEventListener('click', async () => {
  try { showError(''); enter(await request('/api/create',{name:$('name').value,targetPlayers:Number($('target-count').value)},false)); }
  catch (e) { showError(e.message); }
});
$('join').addEventListener('click', async () => {
  try { showError(''); enter(await request('/api/join',{name:$('name').value,code:$('code').value},false)); }
  catch (e) { showError(e.message); }
});
let startPending=false;
$('start').addEventListener('click', async () => { if(startPending||!state?.canStart)return; startPending=true; $('start').disabled=true; $('start').textContent='Opening case…'; const ok=await action('/api/start'); startPending=false; if(!ok&&state?.phase==='lobby')render(state); });
$('call-vote').addEventListener('click', () => action('/api/call-vote'));
$('statement').addEventListener('click', () => action('/api/statement',state?.mode==='duo'?{text:$('duo-statement').value}:{}));
$('chat-form').addEventListener('submit', async event => {
  event.preventDefault();
  const input = $('chat-input'), text = input.value.trim();
  if (!text) return;
  await action('/api/chat', {text});
  input.value = '';
});
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = text;
  return node;
}
function initialsFor(name){return String(name||'').trim().split(/\s+/).filter(Boolean).slice(0,2).map(x=>Array.from(x)[0]||'').join('').toUpperCase();}
function characterMark(name){const mark=el('span','character-mark',initialsFor(name));mark.setAttribute('aria-hidden','true');return mark;}
function renderSuspects(target,suspects){target.replaceChildren();const grid=el('div','suspect-grid');for(const suspect of suspects){const card=el('article','suspect-card');card.append(characterMark(suspect.name));const copy=el('div','suspect-copy');copy.append(el('h4','',suspect.name),el('p','suspect-title',suspect.title),el('p','suspect-motive','Motive · '+suspect.motive));card.append(copy);grid.append(card);}target.append(grid);}
function renderPlayers(target,players,compact=false){target.replaceChildren();for(const player of players){const row=el('div','player'+(compact?' small suspect-player':'')),left=el('div','player-identity');if(compact)left.append(characterMark(player.name));left.append(el('strong','',player.name));if(player.isHost)left.append(el('span','tag','HOST'));row.append(left);row.append(el('span','player-status',(player.connected?'● Online':'○ Away')+(player.hasVoted?' · Vote sealed':'')));if(state?.phase==='reveal')row.append(el('span','score',player.score+' pts'));target.append(row);}
}
function render(s) {
  const previousPhase=lastRenderedPhase,changedPhase=previousPhase!==null&&previousPhase!==s.phase,phases=flowPhases(s),currentIndex=phases.findIndex(x=>x[0]===s.phase);
  if(s.phase==='lobby')viewingPhase='lobby';
  else if(viewingPhase===null||previousPhase==='lobby'||s.caseId!==lastRenderedCaseId||viewingPhase===previousPhase)viewingPhase=s.phase;
  const selectedIndex=phases.findIndex(x=>x[0]===viewingPhase);
  if(selectedIndex<0||selectedIndex>currentIndex)viewingPhase=s.phase;
  const selectedPhase=viewingPhase;
  state=s;
  $('room-code').textContent=s.code;
  renderPhaseProgress(s,selectedPhase);renderPhaseWorkspace(s,selectedPhase);renderActivity(s);renderNotebook(s);
  if(changedPhase&&selectedPhase===s.phase){const h=$('phase-workspace').querySelector('[data-phase-heading]');if(h)h.focus({preventScroll:true});}
  const phaseTitles={lobby:'Waiting room',briefing:'Briefing',investigation:'Investigation',interrogation:'Interrogation',contradiction:'Contradiction challenge',discussion:'Discussion',voting:'Final vote',reveal:'Final reveal'};
  $('phase-status').textContent=s.status;
  $('phase-title').textContent=phaseTitles[s.phase]||s.phase;
  $('case-heading').textContent=s.caseTitle||(s.phase==='lobby'?'Waiting for players':'The Last Alibi');
  $('mode-label').textContent=s.modeLabel||(s.mode==='duo'?'Duo Mode':'Multiplayer Mode');
  $('timer-box').classList.toggle('hidden',s.phase!=='voting');
  $('timer').textContent=s.phase==='voting'&&s.timer!==null?formatTime(s.timer):'—';
  $('timer-label').textContent=s.phase==='voting'?'VOTING CLOSES':'';
  $('vote-title').textContent=s.resolutionPrompt||'Resolve the mystery';
  connection.textContent='Live';
  $('lobby').classList.toggle('hidden',s.phase!=='lobby');
  $('round').classList.toggle('hidden',s.phase==='lobby'||selectedPhase==='reveal');
  $('reveal').classList.toggle('hidden',!(s.phase==='reveal'&&selectedPhase==='reveal'));
  if(s.phase==='lobby'){
    $('player-count').textContent='('+s.players.length+'/'+s.targetPlayers+')';
    $('room-mode').textContent=s.modeLabel+' · fixed for this room';
    $('lobby-rules').textContent=s.mode==='duo'?'Both players investigate. Accuse one NPC suspect. Correct accusation +3; statement +1; no escape bonus or challenge points.':'Each player receives a private character dossier. Correct accusation +3; responsible player escapes for +2 if fewer than half accuse them; statement +1.';
    $('player-target').textContent=s.targetPlayers;
    renderPlayers($('players'),s.players);
    $('start').disabled=!s.canStart;
    $('start').textContent=s.canStart?'Open the case':s.players.length<s.targetPlayers?'Waiting for '+s.targetPlayers+' players':'Only the host can start';
  }
  if(s.dossier){
    $('character').textContent=s.mode==='duo'?'Investigator':s.dossier.name;
    $('character-title').textContent=s.mode==='duo'?'Duo Mode · '+s.caseTitle:s.dossier.title;
    $('objective').textContent=s.dossier.objective||'';
    $('role').textContent=s.mode==='duo'?'INVESTIGATOR':s.dossier.role==='CULPRIT'?'YOU ARE RESPONSIBLE':'SUSPECT';
    $('role').classList.toggle('danger',s.dossier.role==='CULPRIT');
    $('motive').textContent=s.mode==='duo'?'Identify the responsible NPC from the shared record and your private lead.':s.dossier.motive;
    $('alibi').textContent=s.mode==='duo'?'You are not assigned a suspect or culprit role.':s.dossier.alibi;
    $('clue').textContent=s.mode==='duo'?'Your distinct private lead is below and visible only to you.':s.dossier.clue;
    $('duo-statement-wrap').classList.toggle('hidden',s.mode!=='duo');
    $('statement').textContent=s.mode==='duo'?(s.submittedStatement?'Statement on the board':'Publish my statement'):(s.submittedStatement?'Statement on the board':'Put my statement on the board');
    $('secret').textContent=s.phaseFlow==='legacy'&&s.mode!=='duo'?s.dossier.secret:s.privateLead?s.privateLead.text:'Personal lead sealed. Request it during Investigation to read it privately.';
    $('statement').disabled=s.submittedStatement||!['discussion','interrogation'].includes(s.phase);
    $('statement').textContent=s.submittedStatement?'Statement on the board':'Put my statement on the board';
    renderEvidence(s.evidence);renderTimeline(s.timeline);
    if(s.mode==='duo')renderSuspects($('suspects'),s.duoSuspects);else renderPlayers($('suspects'),s.players,true);
    renderStatements(s.statements);renderChat(s.chat);
    $('chat-input').disabled=!['discussion','investigation','interrogation','contradiction','voting'].includes(s.phase);
    $('chat-form').querySelector('button').disabled=!['discussion','investigation','interrogation','contradiction','voting'].includes(s.phase);
    $('call-vote').classList.toggle('hidden',!s.canCallVote);$('call-vote').disabled=!s.canCallVote;
    const voting=s.phase==='voting'&&s.phaseFlow==='legacy';$('voting-panel').classList.toggle('hidden',!voting);$('vote-options').replaceChildren();$('vote-status').textContent=s.myVote?'Your vote is sealed. Waiting for the rest of the room.':'';
    if(voting&&!s.myVote)for(const p of s.players){const button=el('button','vote-button',p.name);button.addEventListener('click',()=>action('/api/vote',{suspect:p.name}));$('vote-options').append(button);}
  }
  if(s.phase==='reveal'&&selectedPhase==='reveal')renderReveal(s);
  lastRenderedPhase=s.phase;lastRenderedCaseId=s.caseId;
}const FLOW_PHASES=[['briefing','Briefing'],['investigation','Investigation'],['interrogation','Interrogation'],['contradiction','Challenge'],['voting','Final vote'],['reveal','Reveal']];
const LEGACY_PHASES=[['discussion','Discussion'],['voting','Final vote'],['reveal','Reveal']];
function flowPhases(s){return s.phaseFlow==='legacy'?LEGACY_PHASES:FLOW_PHASES;}
function phaseName(s,phase){return flowPhases(s).find(x=>x[0]===phase)?.[1]||({lobby:'Waiting room',briefing:'Briefing',investigation:'Investigation',interrogation:'Interrogation',contradiction:'Challenge',discussion:'Discussion',voting:'Final vote',reveal:'Reveal'})[phase]||phase;}
function renderPhaseProgress(s,selectedPhase){const nav=document.querySelector('.phase-track'),list=$('phase-progress'),phases=flowPhases(s),current=phases.findIndex(x=>x[0]===s.phase);nav.classList.toggle('hidden',s.phase==='lobby');list.replaceChildren();for(let i=0;i<phases.length;i++){const [phase,label]=phases[i],li=el('li'),button=el('button','phase-step'+(i<current?' done':''),label);button.type='button';button.disabled=i>current;button.setAttribute('aria-current',i===current?'step':'false');button.setAttribute('aria-pressed',phase===selectedPhase?'true':'false');button.setAttribute('aria-controls',phase==='reveal'?'reveal':'phase-workspace');button.setAttribute('aria-label',phase===s.phase?'Current phase: '+label:'Review '+label);button.addEventListener('click',()=>{if(button.disabled)return;viewingPhase=phase;render(state);});li.append(button);list.append(li);}}function sectionTitle(target,eyebrow,title,description){target.replaceChildren();target.append(el('p','eyebrow',eyebrow));const h=el('h2','',title);h.tabIndex=-1;h.dataset.phaseHeading='true';target.append(h,el('p','phase-intro',description));}
function selectField(labelText,id,items,placeholder){const wrap=el('label','',labelText),sel=el('select');sel.id=id;sel.append(new Option(placeholder,''));for(const item of items)sel.append(new Option(item.label,item.value));wrap.append(sel);return{wrap,select:sel};}
function renderPhaseWorkspace(s,selectedPhase){
 const box=$('phase-workspace');if(!box)return;
 const signature=JSON.stringify([s.phase,selectedPhase,s.phaseFlow,s.investigationBudget,s.privateLead?.at,s.evidence.map(x=>x.id),s.timeline.map(x=>x.id),s.questions,s.challenges,s.statements.map(x=>x.id),s.players.map(x=>x.hasVoted),s.myVote]);
 if(box.dataset.signature===signature)return;box.dataset.signature=signature;box.classList.remove('briefing-workspace');
 box.classList.toggle('hidden',selectedPhase==='reveal'||selectedPhase==='lobby');
 if(selectedPhase==='lobby'||selectedPhase==='reveal')return;
 const current=selectedPhase===s.phase;
 if(selectedPhase==='briefing'){
  sectionTitle(box,'CASE BRIEFING',s.caseTitle||'The case is opened',s.resolutionPrompt+' Study your private dossier. Evidence and votes remain limited to authorized viewers.');
  if(!current)box.append(el('p','phase-review-note','Read-only review. The live phase is '+phaseName(s,s.phase)+'; the round continues normally.'));
  const cover=el('header','briefing-cover');while(box.firstChild)cover.append(box.firstChild);box.append(cover);box.classList.add('briefing-workspace');
  const metadata=el('div','case-metadata');if(s.caseType)metadata.append(el('span','case-meta-chip','CASE TYPE · '+s.caseType));const subject=s.subject?.label||s.subject?.name;if(subject)metadata.append(el('span','case-meta-chip','SUBJECT · '+subject));if(metadata.childElementCount)box.append(metadata);
  const grid=el('div','phase-grid'),role=el('article','action-card');role.append(el('h3','',s.dossier?.role==='CULPRIT'?'Your objective: protect your account':'Your objective: investigate the case'),el('p','',s.dossier?.role==='CULPRIT'?'Explain your actions without contradicting the fixed evidence. You still have access to the shared record.':'Compare your private clue with discoveries and statements players choose to publish.'));
  const points=el('article','action-card');points.append(el('h3','','Round scoring'),el('p','','Correct accusation +3 · statement +1'+(s.mode==='duo'?' · no escape bonus in Duo Mode.':' · responsible player escapes +2 when fewer than half accuse them.')+' No challenge or question points are awarded.'));grid.append(role,points);box.append(grid);return;
 }
 if(!current){renderPhaseReview(box,s,selectedPhase);return;}
 if(selectedPhase==='investigation'){
  sectionTitle(box,'INVESTIGATION',s.caseTitle,'Spend up to '+s.investigationBudgetMax+' actions to uncover authored evidence. Shared discoveries appear on the board; your personal lead stays private.');
  const used=s.investigationUsed,remaining=s.investigationBudget,targets=s.investigationTargets;
  box.append(el('span','budget-chip',remaining+' of '+s.investigationBudgetMax+' actions remaining'),el('p','muted','Each evidence inspection, timeline check, or personal lead uses one action.'));
  const feedback=el('p','status-line hidden','');feedback.id='investigation-feedback';feedback.setAttribute('role','status');feedback.setAttribute('aria-live','polite');box.append(feedback);
  if(remaining===0)box.append(el('p','status-line','You have spent both investigation actions. Discovered information remains on the shared boards.'));
  const grid=el('div','phase-grid');
  const evidenceCard=el('article','action-card');evidenceCard.append(el('h3','',targets.evidence.length?'Inspect sealed evidence':'Evidence discovery'),el('p','',targets.evidence.length?'A discovery becomes public to everyone in the room.':'All authored evidence is unlocked; there is nothing left to inspect.'));
  if(targets.evidence.length){const field=selectField('Choose a sealed item','inspect-target',targets.evidence.map(x=>({label:x.label,value:x.id})),'Select evidence'),btn=el('button','secondary','Inspect evidence');field.select.disabled=remaining<=0;btn.disabled=remaining<=0;btn.addEventListener('click',()=>action('/api/investigate',{kind:'evidence',targetId:field.select.value}));evidenceCard.append(field.wrap,btn);}grid.append(evidenceCard);
  const timeCard=el('article','action-card');timeCard.append(el('h3','',targets.timeline.length?'Check the timeline':'Timeline record'),el('p','',targets.timeline.length?'Open an authored time entry for the shared board.':'All authored timeline entries are unlocked; there is nothing left to check.'));
  if(targets.timeline.length){const field=selectField('Choose a time','timeline-target',targets.timeline.map(x=>({label:x.label,value:x.id})),'Select timeline entry'),btn=el('button','secondary','Check timeline');field.select.disabled=remaining<=0;btn.disabled=remaining<=0;btn.addEventListener('click',()=>action('/api/investigate',{kind:'timeline',targetId:field.select.value}));timeCard.append(field.wrap,btn);}grid.append(timeCard);
  const lead=el('article','action-card');lead.append(el('h3','','Request your personal lead'),el('p','',s.privateLead?'Your private lead is already in your dossier.':'The result is delivered only to your dossier.'));const leadBtn=el('button','secondary',s.privateLead?'Lead received':'Request private lead');leadBtn.disabled=!!s.privateLead||remaining<=0;leadBtn.addEventListener('click',()=>action('/api/investigate',{kind:'personal'}));lead.append(leadBtn);grid.append(lead);box.append(grid);return;
 }
 if(selectedPhase==='interrogation'){
  sectionTitle(box,'INTERROGATION',s.caseTitle,s.mode==='duo'?'Questions use authored NPC claims and responses. Current NPC responses repeat the alibi recorded in the case file; they are not generated direct answers.':'Ask another player about motive, timeline, or evidence. Responses are public; refusal is not proof.');
  const mine=s.questions.filter(q=>q.askerId===s.playerId).length,card=el('article','action-card');card.append(el('span','budget-chip',Math.max(0,2-mine)+' questions remaining'));let target,claimField;
  if(s.mode==='duo'){target=selectField('Question an NPC suspect','question-target',s.suspectOptions.map(x=>({label:x.name,value:x.id})),'Select suspect');claimField=selectField('Authored claim','question-claim',s.claims.map(x=>({label:x.suspectName+': '+x.text,value:x.id})),'Select claim');}
  else target=selectField('Question another player','question-target',s.players.filter(p=>p.id!==s.playerId).map(p=>({label:p.name,value:p.id})),'Select player');
  const category=selectField('Question category','question-category',s.questionCategories.map(c=>({label:c.label,value:c.id})),'Select category'),formText=el('textarea');formText.id='question-text';formText.maxLength=220;formText.placeholder='Write a focused question…';
  const prompt=el('p','muted','Choose a category to see a case-specific prompt.');category.select.addEventListener('change',()=>{prompt.textContent=s.questionCategories.find(c=>c.id===category.select.value)?.prompt||'Choose a category to see a case-specific prompt.';if(!formText.value)formText.value=prompt.textContent;});
  const submit=el('button','primary','Submit question');submit.disabled=!s.canAskQuestion;submit.addEventListener('click',()=>action('/api/question',s.mode==='duo'?{targetNpcId:target.select.value,claimId:claimField.select.value,categoryId:category.select.value,text:formText.value}:{targetPlayerId:target.select.value,categoryId:category.select.value,text:formText.value}));card.append(target.wrap);if(claimField)card.append(claimField.wrap);card.append(category.wrap,prompt,formText,submit);box.append(card);renderQuestions(box,s);return;
 }
 if(selectedPhase==='contradiction'){
  sectionTitle(box,'CONTRADICTION CHALLENGE',s.caseTitle,'Attach a public claim to shared evidence. Only authored case relationships are verified; unsupported pairs remain unverified and award no points.');
  for(const pending of s.challenges.filter(c=>c.targetId===s.playerId&&!c.response))renderChallengeResponse(box,pending);
  const card=el('article','action-card');card.append(el('h3','','Submit a challenge'));const candidates=s.mode==='duo'?s.claims:s.statements.filter(x=>x.playerId!==s.playerId);
  if(candidates.length&&s.evidence.length){const claim=selectField(s.mode==='duo'?'NPC claim':'Public statement','challenge-statement',candidates.map(x=>({label:s.mode==='duo'?x.suspectName+': '+x.text:x.name+': '+x.text,value:x.id})),'Select claim'),evidence=selectField('Supporting public evidence','challenge-evidence',s.evidence.map(x=>({label:x.title,value:x.id}))),reason=el('textarea');reason.id='challenge-reason';reason.maxLength=240;reason.placeholder='Explain the contradiction you see…';const btn=el('button','primary','Check and submit');btn.addEventListener('click',()=>action('/api/challenge',s.mode==='duo'?{claimId:claim.select.value,evidenceId:evidence.select.value,reason:reason.value}:{statementId:claim.select.value,evidenceId:evidence.select.value,reason:reason.value}));card.append(claim.wrap,evidence.wrap,reason,btn);}else card.append(el('p','muted',!candidates.length?'No authored claims are available for this case.':'Unlock evidence during Investigation before challenging a claim.'));
  box.append(card);renderChallenges(box,s);return;
 }
 if(selectedPhase==='voting'){
  sectionTitle(box,'FINAL ACCUSATION',s.caseTitle,s.resolutionPrompt+' Choose '+(s.mode==='duo'?'one NPC suspect.':'one player.')+' Your selection and theory remain sealed until resolution.');const voted=s.players.filter(p=>p.hasVoted).length;box.append(el('span','budget-chip',voted+' of '+s.players.length+' votes sealed'));if(s.myVote){box.append(el('p','private-card','Your vote is sealed. Waiting for remaining players or the deadline.'));return;}
  const card=el('article','action-card'),options=el('div','vote-choice'),choices=s.mode==='duo'?s.suspectOptions.map(x=>({id:x.id,name:x.name})):s.players.map(x=>({id:x.name,name:x.name}));for(const suspect of choices){const label=el('label','suspect-choice'),input=el('input');input.type='radio';input.name='final-vote';input.id='vote-'+suspect.id;input.value=suspect.id;label.append(input,characterMark(suspect.name),el('span','suspect-choice-name',suspect.name));options.append(label);}const theoryLabel=el('label','','Optional final theory'),theory=el('textarea');theory.id='final-theory';theory.maxLength=500;theory.placeholder='What is your strongest reason?';theoryLabel.append(theory);const btn=el('button','primary','Seal my accusation');btn.addEventListener('click',()=>{const choice=box.querySelector('input[name="final-vote"]:checked');if(!choice){showError('Choose a suspect before sealing your vote.');return;}action('/api/vote',{suspect:choice.value,theory:theory.value});});card.append(options,theoryLabel,btn);box.append(card);return;
 }
 if(selectedPhase==='discussion')sectionTitle(box,'DISCUSSION',s.caseTitle,'Legacy discussion phase. Publish one statement and discuss before the host calls the vote.');
}
function renderPhaseReview(box,s,phase){
 sectionTitle(box,phaseName(s,phase).toUpperCase()+' · REVIEW',s.caseTitle||phaseName(s,phase),'Read-only review. The live phase is '+phaseName(s,s.phase)+'; the server clock and game rules continue unchanged.');
 if(phase==='investigation'){
  box.append(el('span','budget-chip',s.investigationUsed+' of '+s.investigationBudgetMax+' actions used'));
  const grid=el('div','phase-grid'),evidenceCard=el('article','action-card');evidenceCard.append(el('h3','','Shared evidence discovered'));
  if(s.evidence.length)for(const item of s.evidence){const card=el('div','evidence-card');card.append(el('h3','',item.title),el('p','',item.text));evidenceCard.append(card);}else evidenceCard.append(el('p','muted','No evidence has been unlocked yet.'));
  const timelineCard=el('article','action-card');timelineCard.append(el('h3','','Timeline entries checked'));if(s.timeline.length)for(const item of s.timeline)timelineCard.append(el('p','',item.time+' — '+item.event));else timelineCard.append(el('p','muted','No timeline entries have been unlocked yet.'));grid.append(evidenceCard,timelineCard);box.append(grid);
  if(s.privateLead){const lead=el('article','action-card');lead.append(el('p','eyebrow','PRIVATE TO YOU'),el('h3','','Your personal lead'),el('p','',s.privateLead.text));box.append(lead);}return;
 }
 if(phase==='interrogation'){renderQuestions(box,s,true);return;}
 if(phase==='contradiction'){renderChallenges(box,s);return;}
 if(phase==='voting'){box.append(el('p','muted',s.phase==='reveal'?'Voting is resolved. The full ballots and score breakdown are available on Reveal.':'Votes stay sealed until the server resolves the final accusation.'));if(s.myVote)box.append(el('p','private-card','Your accusation is sealed. No other ballot is shown here.'));return;}
 if(phase==='discussion'){box.append(el('p','muted','The shared discussion and published statement remain in the room record.'));}
}function renderQuestions(box,s,readOnly=false){
 box.append(el('h3','','Questions & responses'));const transcript=el('div','transcript');if(!s.questions.length)transcript.append(el('p','muted','No questions yet. Choose a player and category to begin.'));
 for(const q of s.questions){
  const card=el('article','transcript-card'+(!q.response&&q.targetId===s.playerId?' pending':''));card.append(el('strong','',q.askerName+' asked '+q.targetName+' · '+q.categoryLabel),el('p','response-label interrogation-question-label','QUESTION'),el('p','question-text',q.text));
  if(q.response?.npc){const kind=q.response.responseType,label=kind==='recorded-alibi'?'REPEATED ALIBI CLAIM':kind==='evasive'?'EVASIVE NPC RESPONSE':kind==='direct-answer'?'DIRECT NPC ANSWER':'AUTHORED NPC RESPONSE';card.append(el('p','eyebrow authored-answer-label',label),el('p','authored-answer',q.response.explanation||''));if(kind==='recorded-alibi')card.append(el('p','muted','This is the suspect’s authored alibi claim from the case file, repeated here; it is not a new answer to the question.'));}
  else if(q.response){const labels={answer:'PLAYER ANSWER',dispute:'PLAYER DISPUTE',decline:'PLAYER DECLINED'};card.append(el('p','eyebrow',labels[q.response.choice]||'PLAYER RESPONSE'),el('p','',q.targetName+(q.response.explanation?': '+q.response.explanation:'')));}
  else if(!readOnly&&q.targetId===s.playerId){const explanation=el('input');explanation.id='answer-'+q.id;explanation.maxLength=280;explanation.placeholder='Required for Answer; optional for Dispute or Decline';const row=el('div','action-row');for(const choice of ['answer','dispute','decline']){const btn=el('button','secondary',choice[0].toUpperCase()+choice.slice(1));btn.addEventListener('click',()=>{if(choice==='answer'&&explanation.value.trim().length<3){explanation.setCustomValidity('Write an answer of at least three characters, or choose Dispute or Decline.');explanation.reportValidity();explanation.focus();return;}explanation.setCustomValidity('');action('/api/question-response',{questionId:q.id,choice,explanation:explanation.value});});row.append(btn);}explanation.addEventListener('input',()=>explanation.setCustomValidity(''));card.append(explanation,row);}
  else card.append(el('p','muted',readOnly?'No response was recorded in this transcript.':'Waiting for the addressed player to respond.'));
  transcript.append(card);
 }
 box.append(transcript);
}function renderChallengeResponse(box,c){const card=el('article','action-card pending');card.append(el('p','eyebrow','YOUR RESPONSE'),el('h3','',c.challengerName+' challenged your statement'),el('p','',c.statement),el('p','',c.evidenceTitle+' · '+c.reason));const explanation=el('textarea');explanation.id='respond-'+c.id;explanation.maxLength=280;explanation.placeholder='Optional response';const row=el('div','action-row');for(const choice of ['accept','dispute','decline']){const btn=el('button','secondary',choice[0].toUpperCase()+choice.slice(1));btn.addEventListener('click',()=>action('/api/challenge-response',{challengeId:c.id,choice,explanation:explanation.value}));row.append(btn);}card.append(explanation,row);box.append(card);}
function renderChallenges(box,s){box.append(el('h3','','Challenge record'));const transcript=el('div','transcript');if(!s.challenges.length)transcript.append(el('p','muted','No challenges have been submitted.'));for(const c of s.challenges){const card=el('article','transcript-card '+(c.verified?'verified':'unverified'));card.append(el('strong','',c.verified?'Verified case contradiction':'Unverified claim'),el('p','',c.challengerName+' challenged '+c.targetName+': '+c.reason),el('p','',c.evidenceTitle+' · '+c.verification));if(c.response?.npc){const kind=c.response.responseType,label=kind==='recorded-alibi'?'NPC ALIBI CLAIM ON RECORD':kind==='evasive'?'AUTHORED EVASIVE RESPONSE':kind==='direct-answer'?'AUTHORED DIRECT ANSWER':'AUTHORED NPC RESPONSE';card.append(el('p','eyebrow authored-answer-label',label),el('p','authored-answer',c.response.explanation||''));if(kind==='recorded-alibi')card.append(el('p','muted','This is the NPC’s case-authored alibi claim, shown separately from the contradiction under review.'));}else if(c.response)card.append(el('p','response-label',c.targetName+' responded '+c.response.choice+(c.response.explanation?': '+c.response.explanation:'')));transcript.append(card);}box.append(transcript);}function renderTimeline(items){const target=$('timeline-board');target.replaceChildren();if(!items.length)return;target.append(el('h3','','Timeline entries unlocked'));for(const x of items){const row=el('div','timeline-entry');row.append(el('strong','',x.time+' — '),document.createTextNode(x.event));target.append(row);}}
function renderActivity(s){const target=$('activity');target.replaceChildren();if(!s.activity?.length){target.append(el('li','muted','No activity yet.'));return;}for(const item of s.activity){const li=el('li','activity-item'),time=el('time','',new Date(item.at).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}));li.append(time,el('strong','',item.actor+': '),document.createTextNode(item.text));target.append(li);}target.scrollTop=target.scrollHeight;}
function renderNotebook(s){const target=$('notebook');if(s.caseId&&target.dataset.caseId!==s.caseId){target.replaceChildren();target.dataset.ready='';target.dataset.caseId=s.caseId;notebookDirty=false;}if(!s.dossier||s.phase==='lobby'||s.phase==='reveal'){target.classList.add('hidden');return;}target.classList.remove('hidden');if(target.dataset.ready!=='true'){target.replaceChildren(el('p','eyebrow','PRIVATE TO YOU'),el('h2','','Theory notebook'),el('p','muted','Only you can read these notes. Your notebook does not cast or change your sealed vote.'));const grid=el('div','notebook-grid'),suspect=selectField('Suspected character','notebook-suspect',[{label:'Undecided',value:''},...s.suspectOptions.map(x=>typeof x==='string'?{label:x,value:x}:{label:x.name,value:x.id})],'Choose a character'),theoryLabel=el('label','','Current theory'),theory=el('textarea'),notesLabel=el('label','','Private notes'),notes=el('textarea');theory.id='notebook-theory';theory.maxLength=280;theory.placeholder='What do you think happened?';notes.id='notebook-notes';notes.maxLength=1000;notes.placeholder='Track clues, questions and contradictions…';theoryLabel.append(theory);notesLabel.append(notes);grid.append(suspect.wrap,theoryLabel);target.append(grid,notesLabel,notes);const status=el('p','status-line','Autosave is on.');status.id='notebook-status';target.append(status);target.dataset.ready='true';const changed=()=>{notebookDirty=true;status.textContent='Unsaved changes';status.className='status-line is-saving';clearTimeout(notebookTimer);notebookTimer=setTimeout(saveNotebook,650);};suspect.select.addEventListener('change',changed);theory.addEventListener('input',changed);notes.addEventListener('input',changed);}
 if(!notebookDirty){$('notebook-suspect').value=s.notebook?.suspect||'';$('notebook-theory').value=s.notebook?.theory||'';$('notebook-notes').value=s.notebook?.notes||'';}}
async function saveNotebook(){if(!state||!notebookDirty)return;const payload={suspect:$('notebook-suspect').value,theory:$('notebook-theory').value,notes:$('notebook-notes').value};$('notebook-status').textContent='Saving privately…';try{await post('/api/notebook',payload);notebookDirty=false;$('notebook-status').textContent='Saved privately';$('notebook-status').className='status-line is-saved';}catch(e){$('notebook-status').textContent='Not saved: '+e.message;$('notebook-status').className='status-line';}}

function formatTime(seconds) {
  const m = Math.floor(seconds / 60), sec = seconds % 60;
  return String(m).padStart(2,'0') + ':' + String(sec).padStart(2,'0');
}
function evidenceCard(item,label='CASE EVIDENCE'){const card=el('article','evidence-card discovered'),head=el('div','evidence-card-head'),mark=el('span','evidence-mark');mark.setAttribute('aria-hidden','true');head.append(mark,el('span','evidence-type',label));card.append(head,el('h3','',item.title),el('p','',item.text));return card;}
function renderEvidence(items){const target=$('evidence');target.replaceChildren();if(!items.length){target.append(el('p','evidence-empty','No shared evidence has been disclosed yet.'));return;}for(const item of items)target.append(evidenceCard(item));}
function renderStatements(items) {
  const target = $('statements'); target.replaceChildren();
  if (!items.length) { target.append(el('p','muted','No statements on the board yet. Each player may publish one.')); return; }
  for (const statement of items) {
    const card = el('article','statement');
    card.append(el('strong','',statement.name),el('p','',statement.text)); target.append(card);
  }
}
function renderChat(items) {
  const target = $('chat'); target.replaceChildren();
  for (const message of items) {
    const line = el('p','chatline'); line.append(el('strong','',message.name + ': '),document.createTextNode(message.text)); target.append(line);
  }
  target.scrollTop = target.scrollHeight;
}
function renderReveal(s){
 const r=s.result,target=$('reveal');target.replaceChildren();const hero=el('header','reveal-hero');hero.append(el('p','eyebrow','CASE CLOSED · THE FINAL REVEAL'+(s.mode==='duo'?' · DUO MODE':'')),el('p','reveal-responsible-label',s.mode==='duo'?'RESPONSIBLE NPC':'RESPONSIBLE PLAYER'),el('h1','reveal-culprit',r.responsiblePlayer||r.responsibleCharacter||r.culprit),el('p','reveal-phrase',r.revealPhrase));target.append(hero,el('p','reveal-method','Method · '+r.method),el('p','reveal-solution',r.solution));
 target.append(el('h2','','Decisive evidence'));for(const item of r.decisiveEvidence||[])target.append(evidenceCard(item,'DECISIVE EVIDENCE'));
 if(r.timeline?.length){target.append(el('h2','','Case timeline'));const list=el('ol','reveal-timeline');for(const beat of r.timeline){const row=el('li','timeline-entry');row.append(el('time','',beat.time),el('span','timeline-event',beat.event));list.append(row);}target.append(list);}
 target.append(el('h2','','Sealed votes and score breakdown'));const table=el('div','reveal-breakdown');for(const vote of r.votes){const part=r.scoreBreakdown?.[vote.playerId]||{},row=el('div','reveal-score');row.append(el('span','reveal-player',vote.name+' voted for '+(vote.suspect||'no one')),el('span','reveal-theory',vote.theory?'Theory: '+vote.theory:''),el('strong','','Correct vote +'+(part.correctVote||0)),el('strong','','Statement +'+(part.statement||0)),...(s.mode==='duo'?[]:[el('strong','','Escape +'+(part.escape||0))]),el('strong','score-total','Total +'+(part.total||0)));table.append(row);}target.append(table);
 if(s.mode==='duo'){target.append(el('h2','','Investigators'));for(const role of r.roles){const card=el('div','role-reveal-card');card.append(characterMark(role.name),el('span','',role.name+' — Investigator'));target.append(card);}target.append(el('h2','','NPC suspects'));for(const npc of r.npcSuspects||[]){const card=el('div','role-reveal-card'+(npc.id===r.responsibleSuspectId?' responsible':''));card.append(characterMark(npc.name),el('span','',npc.name+(npc.id===r.responsibleSuspectId?' · RESPONSIBLE':'')));target.append(card);}}else{target.append(el('h2','','Who was who'));for(const role of r.roles){const card=el('div','role-reveal-card'+(role.role==='CULPRIT'?' responsible':''));card.append(characterMark(role.name),el('span','',role.name+' — '+role.character+(role.role==='CULPRIT'?' · RESPONSIBLE':'')));target.append(card);}}const btn=el('button','primary','Deal a new case');btn.disabled=!s.canRematch;btn.addEventListener('click',()=>action('/api/rematch'));target.append(btn);
}
