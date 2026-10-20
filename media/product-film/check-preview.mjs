import { createRequire } from 'node:module';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { duration, chapters } from './film.mjs';

const [playwrightRoot, output='/private/tmp/archwoven-landing-film-output']=process.argv.slice(2);
const {chromium,webkit}=createRequire(resolve(playwrightRoot,'package.json'))('playwright-core');
const results=[];
const stylesheet=await readFile(new URL('../../apps/web/app/globals.css',import.meta.url),'utf8');
const token=name=>new RegExp(`${name}:\\s*(#[0-9a-f]+)`,'i').exec(stylesheet)[1];
const recordings=JSON.parse(await readFile(new URL('./recordings.json',import.meta.url)));
for(const kind of ['description','repository']){
  assert.deepEqual(recordings[kind],JSON.parse(await readFile(new URL('../../'+recordings.recordings[kind],import.meta.url))));
  results.push(`${kind}: original real-provider output preserved`);
}
assert.equal(recordings.description.nodes.length,14);
assert.equal(recordings.description.edges.length,14);
const browser=await chromium.launch();
try{
  const page=await browser.newPage({viewport:{width:1920,height:1080}});
  await page.goto('http://127.0.0.1:3147/?render=1');
  await page.waitForFunction(()=>window.film);
  assert.equal(await page.locator('#stage>svg>rect').first().getAttribute('fill'),token('--cv-bg'),'Film uses the workspace canvas background');
  assert.equal(await page.locator('#stage>svg text').first().getAttribute('fill'),token('--cv-text'),'Film uses the workspace canvas text');
  results.push('Film palette matches the shared product tokens');
  for(const time of [1.5,21.7]){
    await page.evaluate(t=>window.film.seek(t),time);
    const geometry=await page.locator('#stage>svg').evaluate(svg=>{
      const camera=svg.querySelector('[data-camera]');
      const nodes=[...camera.querySelectorAll('[data-node]')].map(g=>({id:g.dataset.node,box:g.querySelector('rect').getBBox(),screen:g.querySelector('rect').getBoundingClientRect()}));
      const clipped=nodes.filter(n=>n.screen.x<65||n.screen.y<120||n.screen.right>1855||n.screen.bottom>880).map(n=>n.id);
      const overflowingLabels=[...camera.querySelectorAll('[data-node]')].flatMap(g=>{
        const node=g.querySelector('rect').getBBox();
        return [...g.querySelectorAll('text')].filter(text=>{const b=text.getBBox();return b.x<node.x+7||b.x+b.width>node.x+node.width-7;}).map(text=>text.textContent);
      });
      const crossings=[];
      for(const path of camera.querySelectorAll('[data-edge]')){
        const length=path.getTotalLength();
        for(let i=1;i<240;i++){
          const p=path.getPointAtLength(length*i/240);
          const hit=nodes.find(n=>n.id!==path.dataset.from&&n.id!==path.dataset.to&&p.x>n.box.x+2&&p.x<n.box.x+n.box.width-2&&p.y>n.box.y+2&&p.y<n.box.y+n.box.height-2);
          if(hit){crossings.push({edge:path.dataset.edge,node:hit.id});break;}
        }
      }
      return {count:nodes.length,clipped,crossings,overflowingLabels};
    });
    assert.deepEqual(geometry.clipped,[],`Overview clips nodes at ${time}s`);
    assert.deepEqual(geometry.crossings,[],`An edge passes through an unrelated node at ${time}s`);
    assert.deepEqual(geometry.overflowingLabels,[],`Node labels overflow at ${time}s`);
    results.push(`${time}s overview: ${geometry.count} nodes, no clipped nodes or false through-node routes`);
  }
  await page.close();
}finally{await browser.close();}

if(process.env.GEOMETRY_ONLY!=='1')for(const [name,engine]of[['chromium',chromium],['webkit',webkit]]){
  const browser=await engine.launch();
  try{
    for(const width of [1440,390]){
      const page=await browser.newPage({viewport:{width,height:1000},reducedMotion:'reduce'});
      page.setDefaultTimeout(8000);
      const errors=[],requests=[];
      page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>requests.push(r.url()));
      await page.goto('http://127.0.0.1:3147/');
      await page.locator('video').waitFor();
      await page.waitForFunction(()=>document.querySelector('video').readyState>=2);
      assert.equal(await page.locator('video').evaluate(v=>v.paused),true,'Reduced motion must not autoplay');
      assert.equal(await page.locator('video').evaluate(v=>v.muted&&v.loop&&v.playsInline),true);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
      assert.equal(await page.getByRole('link').count(),0,'No watch/download links in landing preview');
      await page.getByRole('button',{name:'Play',exact:true}).click();
      await page.waitForFunction(()=>document.querySelector('video').currentTime>.1);
      await page.getByRole('button',{name:'Pause',exact:true}).click();
      assert.equal(await page.locator('video').evaluate(v=>v.paused),true);
      await page.locator('#tools>summary').click();
      for(const chapter of chapters){
        await page.getByRole('button',{name:chapter.label,exact:true}).click();
        await page.waitForFunction(target=>Math.abs(document.querySelector('video').currentTime-target)<.2,chapter.start+.6,{timeout:8000});
      }
      await page.getByRole('button',{name:'Restart',exact:true}).click();
      await page.waitForFunction(()=>!document.querySelector('video').paused&&document.querySelector('video').currentTime<1.5);
      await page.getByRole('button',{name:'Pause',exact:true}).click();
      await page.locator('#tools>summary').click();
      assert.deepEqual(errors,[]);assert.equal(requests.every(u=>u.startsWith('http://127.0.0.1:3147/')),true);
      await page.screenshot({path:resolve(output,`${name}-${width}-review.jpg`),fullPage:true,type:'jpeg',quality:92});
      const metadata=await page.locator('video').evaluate(v=>({width:v.videoWidth,height:v.videoHeight,duration:v.duration}));
      assert.equal(metadata.width,1920);assert.equal(metadata.height,1080);assert.ok(Math.abs(metadata.duration-duration)<.1);
      results.push(`${name} ${width}px: pause, chapters, restart, reduced motion, local requests, ${duration}s MP4 decode`);
      await page.close();
    }
    const page=await browser.newPage({reducedMotion:'no-preference'});
    await page.goto('http://127.0.0.1:3147/');
    await page.waitForFunction(()=>document.querySelector('video')?.currentTime>.2);
    assert.equal(await page.locator('video').evaluate(v=>!v.paused&&v.muted),true);
    await page.evaluate(end=>{document.querySelector('video').currentTime=end-.15;},duration);
    await page.waitForFunction(()=>document.querySelector('video').currentTime<1.5&&!document.querySelector('video').paused);
    results.push(`${name}: muted autoplay and continuous looping without input`);
  }finally{await browser.close();}
}
await writeFile(resolve(output,'preview-checks.json'),JSON.stringify(results,null,2));
console.log(results.join('\n'));
