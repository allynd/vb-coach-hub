import {test,expect} from '@playwright/test';
import {execFileSync} from 'node:child_process';
const seed={activeTeamId:'qa',players:[{id:'p',teamId:'qa',jersey:99,firstName:'QA',lastName:'Player'}],games:[{id:'g',teamId:'qa',opponent:'QA Opponent',complete:true,sets:[{set:1,home:25,away:20}],rosterSnapshot:['p'],filmReview:{schemaVersion:1,videoId:'ugW5_-zfJKY',model:'synthetic-test',candidates:[{id:'c',start:277,end:278,confidence:null,type:'dig',playerId:'p',set:1,status:'pending',note:'Synthetic test only'}]}}],events:[]};
async function state(page){return page.evaluate(async()=> (await import('/db.js')).loadState());}
test.beforeEach(async({page})=>{
  // The CI suite never accesses user accounts, production Supabase, or YouTube.
  await page.route('https://**/*',route=>route.fulfill({status:200,contentType:'text/html',body:'<p>External playback mocked in CI</p>'}));
  await page.goto('/tests/browser/film-fixture.html');
  await page.evaluate(async s=>(await import('/db.js')).saveState(s),seed);
  await page.getByRole('button',{name:'Film Analysis',exact:true}).click();
});
test('watch, verify, reload and remove preserve match scores and evidence',async({page})=>{
  await page.getByRole('button',{name:'Watch stat at 4:37',exact:true}).click();
  await expect(page.locator('iframe')).toHaveAttribute('src',/start=274&end=280/);
  expect((await state(page)).events).toHaveLength(0);
  await page.getByRole('button',{name:'Verify & add stat',exact:true}).click();
  await expect.poll(async()=>(await state(page)).events.length).toBe(1);
  let s=await state(page);expect(s.sheetPendingOps).toHaveLength(1);expect(s.events[0].film.start).toBe(277);expect(s.events[0].scoreImpact).toBe(0);expect(s.games[0].sets).toEqual(seed.games[0].sets);
  await page.reload();await page.getByRole('button',{name:'Film Analysis',exact:true}).click();
  await expect(page.getByRole('button',{name:'Verify & add stat',exact:true})).toHaveCount(0);
  await page.evaluate(async()=>{const {mutateState}=await import('/db.js');const {applySheetOps}=await import('/sheet-ops.mjs');await mutateState(s=>applySheetOps(s,[{action:'delete',event_id:s.events[0].id}]));});
  await page.reload();await page.getByRole('button',{name:'Film Analysis',exact:true}).click();
  expect((await state(page)).events).toHaveLength(0);
  await expect(page.getByRole('button',{name:'Verify & add stat',exact:true})).toHaveCount(0);
  await page.screenshot({path:test.info().outputPath('review.png'),fullPage:true});
});
test('native local MP4 plays with trimmed-file offset; closing pauses it',async({page},info)=>{
  const clip=info.outputPath('synthetic.mp4');
  execFileSync('ffmpeg',['-v','error','-f','lavfi','-i','testsrc=size=320x180:rate=30','-t','5','-pix_fmt','yuv420p',clip]);
  await page.locator('[data-video-file]').setInputFiles(clip);
  await expect.poll(()=>page.locator('video').evaluate(v=>v.readyState)).toBeGreaterThanOrEqual(1);
  await page.locator('[data-video-offset]').fill('277');
  await page.getByRole('button',{name:'Watch stat at 4:37',exact:true}).click();
  await expect.poll(()=>page.locator('video').evaluate(v=>v.currentTime)).toBeGreaterThan(0);
  expect((await state(page)).events).toHaveLength(0);
  await page.getByRole('button',{name:'Close',exact:true}).click();
  await expect.poll(()=>page.locator('video').evaluate(v=>v.paused)).toBe(true);
});
