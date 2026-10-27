// Browser export feature. Workbook generation stays on this device, including offline.
import { correctionSetNumbers } from './match-corrections.mjs';
import { withPerSetRates } from './player-set-rates.mjs';
import {buildPlayerSeasonReport} from './player-season-report.mjs';
const escapeHtml=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fields=[['Sets Played','SP'],['Kills','K'],['Kills / Set','KPS','0.00'],['Digs / Set','DPS','0.00'],['Blocks / Set','BPS','0.00'],['Attack Errors','E'],['Attempts','ATTEMPTS'],['2-Hand Tips','TIPS'],['Total Attacks','ATT'],['Hitting %','HIT','0.000'],['Aces','ACE'],['Serve Errors','SE'],['Foot Faults','FOOTFAULT'],['Serve Attempts','SA'],['Serve In %','SERVE','0.0%'],['Solo Blocks','BS'],['Block Assists','BA'],['Block Errors','BE','#,##0.##'],['Assists','A'],['Digs','D'],['Defensive Errors','DE'],['Set Errors / BHE','BHE'],['Non-Setter OOS','OOS'],['Receive Attempts','PR'],['Receive Errors','RE'],['Overpasses','OVERPASS'],['Pass Average','PASS','0.00'],['Receive Error %','RECEIVE_ERROR','0.0%'],['Receive Success %','RECEIVE_SUCCESS','0.0%'],['Defensive Success %','DEFENSE_SUCCESS','0.0%']];
const key=p=>p.personId||p.id;
export function exportReportData(state,options,summarize){
 const team=state.teams.find(t=>t.id===options.teamId);if(!team)throw Error('Choose a team.');
 const teamGames=state.games.filter(g=>g.teamId===team.id);
 const game=teamGames.find(g=>g.id===options.gameId);
 const teamIds=new Set(teamGames.map(g=>g.id));
 const allTeamEvents=state.events.filter(e=>teamIds.has(e.gameId)||(e.kind==='season_adjustment'&&e.teamId===team.id));
 const selected=state.players.find(p=>p.id===options.playerId);
 const career=options.scope==='career';
 const people=new Map();
 state.players.filter(p=>p.teamId===team.id).forEach(p=>people.set(career?key(p):p.id,p));
 let events=allTeamEvents;
 if(options.scope==='match'||options.scope==='set'){
  if(!game)throw Error('Choose a match.');
  events=state.events.filter(e=>e.gameId===game.id);
  const ids=new Set([...(game.rosterSnapshot||[]).map(p=>typeof p==='string'?p:p.playerId),...events.map(e=>e.playerId).filter(Boolean),...(game.manualRecord?state.players.filter(p=>p.teamId===team.id&&!p.archived).map(p=>p.id):[])]);
  people.clear();for(const id of ids){const p=state.players.find(p=>p.id===id);const snap=(game.rosterSnapshot||[]).find(p=>p.playerId===id);people.set(id,p||{...snap,id,firstName:snap?.firstName||'Historical player'});}
  if(options.scope==='set')events=events.filter(e=>Number(e.set)===Number(options.setNo));
 }
 if(selected){people.clear();people.set(career?key(selected):selected.id,selected);}
 if(career){const keys=new Set(people.keys());const ids=new Set(state.players.filter(p=>keys.has(key(p))).map(p=>p.id));events=state.events.filter(e=>ids.has(e.playerId));}
 const rows=(ev,scopeGames,onlySet=null)=>[...people.values()].map(p=>{
  const ids=new Set(career?state.players.filter(x=>key(x)===key(p)).map(x=>x.id):[p.id]);
  const stats=summarize(ev.filter(e=>ids.has(e.playerId)));
  return {player:p,stats:withPerSetRates(stats,scopeGames,ev,ids,onlySet)};
 });
 const section=(name,ev,scopeGames,onlySet=null)=>({name,rows:rows(ev,scopeGames,onlySet),teamStats:summarize(ev),hasTeamTotals:!selected&&!career});
 const scopeGames=(options.scope==='match'||options.scope==='set')?[game]:career?state.games:teamGames;
 const sections=[section(options.scope==='match'?'Match Total':options.scope==='set'?`Set ${options.setNo}`:career?'Career Total':'Season Total',events,scopeGames,options.scope==='set'?Number(options.setNo):null)];
 if(options.scope==='match'){
  const sets=correctionSetNumbers(game,events);
  for(const n of sets)sections.push(section(`Set ${n}`,events.filter(e=>Number(e.set)===n),[game],n));
 }
 if(career){for(const t of state.teams){const games=state.games.filter(g=>g.teamId===t.id);const ids=new Set(games.map(g=>g.id));const ev=events.filter(e=>ids.has(e.gameId)||(e.kind==='season_adjustment'&&e.teamId===t.id));if(ev.length)sections.push(section(`${t.name} ${t.season||''}`,ev,games));}}
 const title=`${team.name} — ${selected?`${selected.firstName} ${selected.lastName||''} — `:''}${options.scope==='match'||options.scope==='set'?`vs ${game.opponent} (${game.date||''})`:career?'Career Stats':`Season ${team.season||''}`}`;
 return {title,sections,filename:`${team.name}-${selected?selected.firstName+'-':''}${options.scope}${options.scope==='set'?'-'+options.setNo:''}.xlsx`};
}
export async function writeExcelReport(report){
 if(!globalThis.ExcelJS)throw Error('Excel exporter has not loaded. Reopen the app while online once, then try again.');
 const wb=new ExcelJS.Workbook();wb.creator='Coach Hub';wb.created=new Date();wb.calcProperties.fullCalcOnLoad=true;
 const used=new Set();
 for(const section of report.sections){
  const base=section.name.replace(/[\\/*?:\[\]]/g,' ').slice(0,27)||'Stats';let name=base,n=1;while(used.has(name))name=base.slice(0,26)+' '+(++n);used.add(name);
  const ws=wb.addWorksheet(name,{views:[{state:'frozen',xSplit:1,ySplit:5,showGridLines:false}]});
  ws.columns=[{width:30},{width:10},{width:12},...fields.map(([label])=>({width:Math.max(12,Math.min(19,label.length+1))}))];
  ws.mergeCells('A1:H1');ws.getCell('A1').value=report.title;ws.getRow(1).height=32;ws.getCell('A1').font={name:'Calibri',size:17,bold:true,color:{argb:'FFFFFFFF'}};ws.getCell('A1').fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF142B45'}};
  ws.mergeCells('A2:H2');ws.getCell('A2').value=section.name;ws.getCell('A2').font={size:12,bold:true,color:{argb:'FF087F8C'}};
  ws.mergeCells('A3:H3');ws.getCell('A3').value=section.hasTeamTotals?`Opponent Missed Serves: ${section.teamStats.OSE}`:'Individual player statistics';
  const header=ws.getRow(5);header.values=['Player','Jersey','Position',...fields.map(f=>f[0])];header.height=44;
  header.eachCell(c=>{c.font={bold:true,color:{argb:'FFFFFFFF'},size:11};c.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF087F8C'}};c.alignment={vertical:'middle',wrapText:true};});
  const data=section.rows.map(({player,stats})=>[`${player.firstName||''} ${player.lastName||''}`.trim(),String(player.jersey??''),player.position||'',...fields.map(([,k])=>stats[k]??null)]);
  if(section.hasTeamTotals)data.push(['TEAM TOTAL','','',...fields.map(([,k])=>section.teamStats[k]??null)]);
  data.forEach((values,i)=>{
   const row=ws.getRow(i+6);row.values=values;row.height=24;const total=section.hasTeamTotals&&i===data.length-1;
   row.eachCell({includeEmpty:true},(c,j)=>{c.font={name:'Calibri',size:11,bold:total,color:{argb:total?'FF142B45':'FF263445'}};c.fill={type:'pattern',pattern:'solid',fgColor:{argb:total?'FFD5ECEE':i%2?'FFF0F4F8':'FFFFFFFF'}};c.alignment={vertical:'middle',horizontal:j>=4?'right':'left'};if(j>=4)c.numFmt=fields[j-4][2]||'#,##0';});
   // Derive formula columns by stat keys, not fixed Excel letters: adding
   // columns must never silently corrupt hitting, serving or defensive rates.
   const r=i+6;
   const ref=k=>`${ws.getColumn(4+fields.findIndex(f=>f[1]===k)).letter}${r}`;
   const formulas={
     ATT:`${ref('K')}+${ref('E')}+${ref('ATTEMPTS')}`,
     HIT:`IF(${ref('ATT')}=0,0,(${ref('K')}-${ref('E')})/${ref('ATT')})`,
     SERVE:`IF(${ref('SA')}=0,0,(${ref('SA')}-${ref('SE')})/${ref('SA')})`,
     KPS:`IF(${ref('SP')}=0,"",${ref('K')}/${ref('SP')})`,
     DPS:`IF(${ref('SP')}=0,"",${ref('D')}/${ref('SP')})`,
     BPS:`IF(${ref('SP')}=0,"",(${ref('BS')}+${ref('BA')})/${ref('SP')})`,
     RECEIVE_ERROR:`IF(${ref('PR')}=0,"",${ref('RE')}/${ref('PR')})`,
     RECEIVE_SUCCESS:`IF(${ref('PR')}=0,"",(${ref('PR')}-${ref('RE')})/${ref('PR')})`,
     DEFENSE_SUCCESS:`IF(${ref('D')}+${ref('DE')}=0,"",${ref('D')}/(${ref('D')}+${ref('DE')}))`
   };
   for(const [key,formula] of Object.entries(formulas)){
     const cell=ws.getCell(ref(key));cell.value={formula,result:cell.value??''};
   }
  });
  ws.autoFilter={from:'A5',to:`${ws.getRow(5).getCell(3+fields.length).address.replace(/\d+$/,'')}${5+section.rows.length}`};
  const note=ws.getRow(8+data.length);note.getCell(1).value='Attempts exclude kills and attack errors; two-hand tips are included in non-kill attempts. Overpasses count as 1-point receptions (not receive errors). Kills/Set, Digs/Set and individual Blocks/Set use documented player set appearances; Blocks/Set = (solo blocks + block assists) / sets played. No recorded opportunities = blank rate. Career totals use linked player identities.';ws.mergeCells(note.number,1,note.number,8);note.height=46;note.getCell(1).alignment={wrapText:true};note.getCell(1).font={size:10,color:{argb:'FF596A7B'}};
 }
 const bytes=await wb.xlsx.writeBuffer();return new Blob([bytes],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
}
/** Detailed player-only season export: one aggregate row, then one row per match. */
export async function writePlayerSeasonWorkbook(report){
 if(!globalThis.ExcelJS)throw Error('Excel exporter has not loaded. Reopen the app while online once, then try again.');
 const wb=new ExcelJS.Workbook();
 wb.creator='Coach Hub';wb.created=new Date();wb.calcProperties.fullCalcOnLoad=true;
 const ws=wb.addWorksheet('Season Match Breakdown',{views:[{state:'frozen',xSplit:2,ySplit:6,showGridLines:false}],pageSetup:{orientation:'landscape',fitToPage:true,fitToWidth:1,fitToHeight:0}});
 const meta=[['Date',15],['Opponent',25],['Tournament',26],['Round',18],['Result',14],['Sets',12],['Set Scores',32],['Participation',30]];
 ws.columns=[...meta.map(([_,width])=>({width})),...fields.map(([label])=>({width:Math.max(13,Math.min(20,label.length+2))}))];
 ws.mergeCells(1,1,1,12);
 const title=ws.getCell('A1');
 title.value=[report.player.firstName,report.player.lastName].filter(Boolean).join(' ')+' — Season '+(report.team.season||'');
 title.font={name:'Calibri',size:18,bold:true,color:{argb:'FFFFFFFF'}};
 title.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF142B45'}};
 title.alignment={vertical:'middle'};ws.getRow(1).height=36;
 ws.mergeCells(2,1,2,12);
 ws.getCell('A2').value=report.team.name+' • #'+(report.player.jersey||'—')+' • '+(report.player.position||'Player');
 ws.getCell('A2').font={name:'Calibri',size:12,bold:true,color:{argb:'FF087F8C'}};
 ws.getRow(2).height=25;
 ws.mergeCells(3,1,3,12);
 ws.getCell('A3').value='Season totals are first. Each match is one row below. A separate adjustments row appears only if season-only corrections exist.';
 ws.getCell('A3').font={name:'Calibri',size:10,color:{argb:'FF596A7B'}};
 ws.getCell('A3').alignment={wrapText:true,vertical:'middle'};ws.getRow(3).height=26;
 const header=ws.getRow(5);header.values=[...meta.map(m=>m[0]),...fields.map(f=>f[0])];header.height=46;
 header.eachCell({includeEmpty:true},cell=>{cell.font={name:'Calibri',size:10,bold:true,color:{argb:'FFFFFFFF'}};cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF087F8C'}};cell.alignment={vertical:'middle',wrapText:true};});
 const fullMeta=(label,extra={})=>[extra.date||'',label,extra.tournament||'',extra.round||'',extra.result||'',extra.sets||'',extra.setScores||'',extra.participation||''];
 const rows=[{kind:'total',meta:fullMeta('SEASON TOTAL',{participation:'Entire season'}),stats:report.seasonStats}];
 for(const match of report.matches){
  rows.push({kind:'match',meta:[match.date,match.opponent,match.tournament,match.round,match.result,match.sets,match.setScores,match.participation],stats:match.stats});
 }
 if(report.adjustmentStats)rows.push({kind:'adjustments',meta:fullMeta('SEASON ADJUSTMENTS',{participation:'Corrections only; not a match'}),stats:report.adjustmentStats});
 rows.forEach(({kind,meta,stats},i)=>{
  const idx=6+i,row=ws.getRow(idx),isTotal=kind==='total',isAdjustment=kind==='adjustments';
  row.values=[...meta,...fields.map(([,key])=>stats[key]??null)];row.height=isTotal?31:26;
  row.eachCell({includeEmpty:true},(cell,j)=>{
   const fill=isTotal?'FFD5ECEE':isAdjustment?'FFFCEBC8':i%2?'FFFFFFFF':'FFF0F4F8';
   cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:fill}};
   cell.font={name:'Calibri',size:10,bold:isTotal||isAdjustment,color:{argb:'FF263445'}};
   cell.alignment={vertical:'middle',horizontal:j>meta.length?'right':'left'};
   if(j>meta.length)cell.numFmt=fields[j-meta.length-1][2]||'#,##0';
  });
  // Calculated columns reference the counts in this SAME row, not rounded match rates.
  const ref=key=>ws.getColumn(meta.length+1+fields.findIndex(f=>f[1]===key)).letter+idx;
  const formulas={
   ATT:ref('K')+'+'+ref('E')+'+'+ref('ATTEMPTS'),
   HIT:'IF('+ref('ATT')+'=0,0,('+ref('K')+'-'+ref('E')+')/'+ref('ATT')+')',
   SERVE:'IF('+ref('SA')+'=0,0,('+ref('SA')+'-'+ref('SE')+')/'+ref('SA')+')',
   KPS:'IF('+ref('SP')+'=0,"",'+ref('K')+'/'+ref('SP')+')',
   DPS:'IF('+ref('SP')+'=0,"",'+ref('D')+'/'+ref('SP')+')',
   BPS:'IF('+ref('SP')+'=0,"",('+ref('BS')+'+'+ref('BA')+')/'+ref('SP')+')',
   RECEIVE_ERROR:'IF('+ref('PR')+'=0,"",'+ref('RE')+'/'+ref('PR')+')',
   RECEIVE_SUCCESS:'IF('+ref('PR')+'=0,"",('+ref('PR')+'-'+ref('RE')+')/'+ref('PR')+')',
   DEFENSE_SUCCESS:'IF('+ref('D')+'+'+ref('DE')+'=0,"",'+ref('D')+'/('+ref('D')+'+'+ref('DE')+'))'
  };
  for(const [key,formula] of Object.entries(formulas)){const cell=ws.getCell(ref(key));cell.value={formula,result:cell.value??''};}
 });
 if(!report.matches.length){const row=ws.getRow(7);row.getCell(2).value='No matches recorded for this season.';row.getCell(2).font={italic:true,color:{argb:'FF596A7B'}};}
 ws.autoFilter={from:{row:5,column:1},to:{row:5+rows.length,column:meta.length+fields.length}};
 const note=ws.getRow(9+rows.length);
 ws.mergeCells(note.number,1,note.number,12);note.height=55;
 note.getCell(1).value='Each row represents one team match, even if the player did not play. Sets Played counts documented court appearances, not roster membership. Rates are recalculated from totals, not averaged match percentages. Attempts exclude kills/errors; overpasses count as 1-point passes. Season adjustments are not assigned to any match.';
 note.getCell(1).font={name:'Calibri',size:10,color:{argb:'FF596A7B'}};
 note.getCell(1).alignment={wrapText:true,vertical:'top'};
 const bytes=await wb.xlsx.writeBuffer();
 return new Blob([bytes],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
}
export function openExcelExport({state,summarize,gameId=null,playerId=null,scope=null}){
 let dialog=document.querySelector('#excelExportDialog');if(!dialog){dialog=document.createElement('dialog');dialog.id='excelExportDialog';dialog.className='quick-stat-dialog';document.body.append(dialog);}
 const team=state.teams.find(t=>t.id===state.activeTeamId);if(!team)return alert('Choose a team first.');
 const games=state.games.filter(g=>g.teamId===team.id).sort((a,b)=>String(b.date).localeCompare(String(a.date)));
 const players=state.players.filter(p=>p.teamId===team.id).sort((a,b)=>String(a.lastName).localeCompare(String(b.lastName)));
 dialog.innerHTML=`<form method="dialog" class="quick-stat-sheet"><div class="quick-stat-head"><h2>Export Excel Stats</h2><button class="icon-btn" aria-label="Close">✕</button></div><div class="field"><label>Period</label><select id="excelScope"><option value="set">One Set</option><option value="match">Match + Set Breakdowns</option><option value="season">Season</option><option value="playerSeason">Player Season + Match Breakdown</option><option value="career">Career</option></select></div><div class="field" id="excelMatchField"><label>Match</label><select id="excelMatch">${games.map(g=>`<option value="${escapeHtml(g.id)}">${escapeHtml(g.date)} vs ${escapeHtml(g.opponent)}</option>`).join('')}</select></div><div class="field" id="excelSetField"><label>Set</label><select id="excelSet"></select></div><div class="field"><label>Players</label><select id="excelPlayer"><option value="">All Players</option>${players.map(p=>`<option value="${escapeHtml(p.id)}">#${escapeHtml(p.jersey)} ${escapeHtml(p.firstName)} ${escapeHtml(p.lastName)}${p.archived?' (archived)':''}</option>`).join('')}</select></div><p class="muted">Player Season + Match Breakdown exports one sheet with a total followed by every match and any separate season corrections. Career exports combine linked player profiles across saved seasons. Opponent missed serves appear on team set, match, and season reports.</p><p id="excelStatus" role="status"></p><button type="button" class="btn primary" id="excelDownload">Download .xlsx</button></form>`;
 const q=s=>dialog.querySelector(s);q('#excelScope').value=scope||(gameId?'match':'season');if(gameId)q('#excelMatch').value=gameId;if(playerId)q('#excelPlayer').value=playerId;
 function refresh(){const scope=q('#excelScope').value;const match=games.find(g=>g.id===q('#excelMatch').value);q('#excelMatchField').hidden=!['set','match'].includes(scope);q('#excelSetField').hidden=scope!=='set';const ev=state.events.filter(e=>e.gameId===match?.id);const sets=match?correctionSetNumbers(match,ev):[];q('#excelSet').innerHTML=sets.map(n=>`<option value="${n}">Set ${n}</option>`).join('');q('#excelDownload').disabled=(scope==='playerSeason'&&!q('#excelPlayer').value)||(['set','match'].includes(scope)&&(!match||(scope==='set'&&!sets.length)));}
 q('#excelScope').onchange=refresh;q('#excelMatch').onchange=refresh;q('#excelPlayer').onchange=refresh;refresh();
 q('#excelDownload').onclick=async()=>{const button=q('#excelDownload');button.disabled=true;q('#excelStatus').textContent='Preparing workbook…';try{const selectedScope=q('#excelScope').value;const report=selectedScope==='playerSeason'?buildPlayerSeasonReport(state,{teamId:team.id,playerId:q('#excelPlayer').value},summarize):exportReportData(state,{teamId:team.id,scope:selectedScope,gameId:q('#excelMatch').value,setNo:q('#excelSet').value,playerId:q('#excelPlayer').value},summarize);const blob=selectedScope==='playerSeason'?await writePlayerSeasonWorkbook(report):await writeExcelReport(report);const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=report.filename.replace(/[\\/:*?"<>|]/g,'-');document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),60000);q('#excelStatus').textContent='Workbook downloaded.';}catch(e){q('#excelStatus').textContent=e.message;}finally{refresh();}};
 dialog.showModal();
}
