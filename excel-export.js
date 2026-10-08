// Browser export feature. Workbook generation stays on this device, including offline.
const escapeHtml=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fields=[['Kills','K'],['Attack Errors','E'],['Attempts','ATTEMPTS'],['Total Attacks','ATT'],['Hitting %','HIT','0.000'],['Aces','ACE'],['Serve Errors','SE'],['Serve Attempts','SA'],['Serve In %','SERVE','0.0%'],['Solo Blocks','BS'],['Block Assists','BA'],['Block Errors','BE','#,##0.##'],['Assists','A'],['Digs','D'],['Defensive Errors','DE'],['Set Errors / BHE','BHE'],['Receive Attempts','PR'],['Receive Errors','RE'],['Overpasses','OVERPASS'],['Pass Average','PASS','0.00'],['Receive Error %','RECEIVE_ERROR','0.0%'],['Receive Success %','RECEIVE_SUCCESS','0.0%'],['Defensive Success %','DEFENSE_SUCCESS','0.0%']];
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
  const ids=new Set([...(game.rosterSnapshot||[]).map(p=>typeof p==='string'?p:p.playerId),...events.map(e=>e.playerId).filter(Boolean)]);
  people.clear();for(const id of ids){const p=state.players.find(p=>p.id===id);const snap=(game.rosterSnapshot||[]).find(p=>p.playerId===id);people.set(id,p||{...snap,id,firstName:snap?.firstName||'Historical player'});}
  if(options.scope==='set')events=events.filter(e=>Number(e.set)===Number(options.setNo));
 }
 if(selected){people.clear();people.set(career?key(selected):selected.id,selected);}
 if(career){const keys=new Set(people.keys());const ids=new Set(state.players.filter(p=>keys.has(key(p))).map(p=>p.id));events=state.events.filter(e=>ids.has(e.playerId));}
 const rows=ev=>[...people.values()].map(p=>{
  const ids=new Set(career?state.players.filter(x=>key(x)===key(p)).map(x=>x.id):[p.id]);
  return {player:p,stats:summarize(ev.filter(e=>ids.has(e.playerId)))};
 });
 const section=(name,ev)=>({name,rows:rows(ev),teamStats:summarize(ev),hasTeamTotals:!selected&&!career});
 const sections=[section(options.scope==='match'?'Match Total':options.scope==='set'?`Set ${options.setNo}`:career?'Career Total':'Season Total',events)];
 if(options.scope==='match'){
  const sets=[...new Set([...(game.sets||[]).map((s,i)=>Number(s.set)||i+1),...events.map(e=>Number(e.set)).filter(n=>n>0),...(game.complete?[]:[Number(game.currentSet)||1])])].sort((a,b)=>a-b);
  for(const n of sets)sections.push(section(`Set ${n}`,events.filter(e=>Number(e.set)===n)));
 }
 if(career){for(const t of state.teams){const ids=new Set(state.games.filter(g=>g.teamId===t.id).map(g=>g.id));const ev=events.filter(e=>ids.has(e.gameId)||(e.kind==='season_adjustment'&&e.teamId===t.id));if(ev.length)sections.push(section(`${t.name} ${t.season||''}`,ev));}}
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
   // Editable formulas keep efficiencies consistent if counts are corrected in Excel.
   const r=i+6;const formulas={G:`D${r}+E${r}+F${r}`,H:`IF(G${r}=0,0,(D${r}-E${r})/G${r})`,L:`IF(K${r}=0,0,(K${r}-J${r})/K${r})`,X:`IF(T${r}=0,"",U${r}/T${r})`,Y:`IF(T${r}=0,"",(T${r}-U${r})/T${r})`,Z:`IF(Q${r}+R${r}=0,"",Q${r}/(Q${r}+R${r}))`};
   for(const [col,formula] of Object.entries(formulas)){const cell=ws.getCell(`${col}${r}`);cell.value={formula,result:cell.value??''};}
  });
  ws.autoFilter={from:'A5',to:`Z${5+section.rows.length}`};
  const note=ws.getRow(8+data.length);note.getCell(1).value='Attempts exclude kills and attack errors. Overpasses count as receptions, not receive errors. No recorded opportunities = blank rate. Career totals use linked player identities.';ws.mergeCells(note.number,1,note.number,8);note.height=46;note.getCell(1).alignment={wrapText:true};note.getCell(1).font={size:10,color:{argb:'FF596A7B'}};
 }
 const bytes=await wb.xlsx.writeBuffer();return new Blob([bytes],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
}
export function openExcelExport({state,summarize,gameId=null,playerId=null}){
 let dialog=document.querySelector('#excelExportDialog');if(!dialog){dialog=document.createElement('dialog');dialog.id='excelExportDialog';dialog.className='quick-stat-dialog';document.body.append(dialog);}
 const team=state.teams.find(t=>t.id===state.activeTeamId);if(!team)return alert('Choose a team first.');
 const games=state.games.filter(g=>g.teamId===team.id).sort((a,b)=>String(b.date).localeCompare(String(a.date)));
 const players=state.players.filter(p=>p.teamId===team.id).sort((a,b)=>String(a.lastName).localeCompare(String(b.lastName)));
 dialog.innerHTML=`<form method="dialog" class="quick-stat-sheet"><div class="quick-stat-head"><h2>Export Excel Stats</h2><button class="icon-btn" aria-label="Close">✕</button></div><div class="field"><label>Period</label><select id="excelScope"><option value="set">One Set</option><option value="match">Match + Set Breakdowns</option><option value="season">Season</option><option value="career">Career</option></select></div><div class="field" id="excelMatchField"><label>Match</label><select id="excelMatch">${games.map(g=>`<option value="${escapeHtml(g.id)}">${escapeHtml(g.date)} vs ${escapeHtml(g.opponent)}</option>`).join('')}</select></div><div class="field" id="excelSetField"><label>Set</label><select id="excelSet"></select></div><div class="field"><label>Players</label><select id="excelPlayer"><option value="">All Players</option>${players.map(p=>`<option value="${escapeHtml(p.id)}">#${escapeHtml(p.jersey)} ${escapeHtml(p.firstName)} ${escapeHtml(p.lastName)}${p.archived?' (archived)':''}</option>`).join('')}</select></div><p class="muted">Career exports combine linked player profiles across saved seasons. Opponent missed serves appear on team set, match, and season reports.</p><p id="excelStatus" role="status"></p><button type="button" class="btn primary" id="excelDownload">Download .xlsx</button></form>`;
 const q=s=>dialog.querySelector(s);q('#excelScope').value=gameId?'match':'season';if(gameId)q('#excelMatch').value=gameId;if(playerId)q('#excelPlayer').value=playerId;
 function refresh(){const scope=q('#excelScope').value;const match=games.find(g=>g.id===q('#excelMatch').value);q('#excelMatchField').hidden=!['set','match'].includes(scope);q('#excelSetField').hidden=scope!=='set';const ev=state.events.filter(e=>e.gameId===match?.id);const sets=[...new Set([...(match?.sets||[]).map((s,i)=>Number(s.set)||i+1),...ev.map(e=>Number(e.set)).filter(n=>n>0),...(match&&!match.complete?[Number(match.currentSet)||1]:[])])].sort((a,b)=>a-b);q('#excelSet').innerHTML=sets.map(n=>`<option value="${n}">Set ${n}</option>`).join('');q('#excelDownload').disabled=['set','match'].includes(scope)&&(!match||(scope==='set'&&!sets.length));}
 q('#excelScope').onchange=refresh;q('#excelMatch').onchange=refresh;refresh();
 q('#excelDownload').onclick=async()=>{const button=q('#excelDownload');button.disabled=true;q('#excelStatus').textContent='Preparing workbook…';try{const report=exportReportData(state,{teamId:team.id,scope:q('#excelScope').value,gameId:q('#excelMatch').value,setNo:q('#excelSet').value,playerId:q('#excelPlayer').value},summarize);const blob=await writeExcelReport(report);const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=report.filename.replace(/[\\/:*?"<>|]/g,'-');document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),60000);q('#excelStatus').textContent='Workbook downloaded.';}catch(e){q('#excelStatus').textContent=e.message;}finally{refresh();}};
 dialog.showModal();
}
