const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {execFileSync,spawn}=require('node:child_process');
async function worker(){
  const {app,BrowserWindow}=require('electron');
  const [root,origin]=process.argv.slice(3);
  app.setPath('userData',path.join(root,'user-data'));app.disableHardwareAcceleration();
  await app.whenReady();app.dock?.hide();
  const {configure}=require('../scripts/tode-direct-browser.cjs');
  const config={origin,certificate:fs.readFileSync(root+'/cert','utf8'),partition:'persist:direct-test',cookie:'editor=verified'};
  configure(config);
  const window=new BrowserWindow({show:false,webPreferences:{partition:config.partition}});
  await window.loadURL(origin+'/');
  const message=await window.webContents.executeJavaScript(`new Promise((resolve,reject)=>{
    const ws=new WebSocket(${JSON.stringify(origin.replace('https:','wss:')+'/socket')});
    ws.onmessage=e=>{resolve(e.data);ws.close();};ws.onerror=()=>reject(new Error('WSS failed'));
  })`);
  assert.equal(message,'ok');
  window.destroy();
  const bad={...config,partition:'persist:wrong-cert',certificate:fs.readFileSync(root+'/other-cert','utf8')};
  configure(bad);
  const denied=new BrowserWindow({show:false,webPreferences:{partition:bad.partition}});
  await assert.rejects(denied.loadURL(origin+'/'),/CERT|certificate|ERR_FAILED/i);
  denied.destroy();fs.writeFileSync(root+'/passed','ok');
  console.log('Real Electron: pinned HTTPS and authenticated WSS pass; incorrect pin rejected');app.quit();
}
async function main(){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'shellos-electron-direct-'));
  let server;
  try{
    for(const name of ['', 'other-'])execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-days','1','-subj','/CN=localhost','-addext','subjectAltName=IP:127.0.0.1','-keyout',root+'/'+name+'key','-out',root+'/'+name+'cert'],{stdio:'ignore'});
    server=require('node:https').createServer({key:fs.readFileSync(root+'/key'),cert:fs.readFileSync(root+'/cert')},(req,res)=>{
      res.writeHead(req.headers.cookie==='editor=verified'?200:401,{'Content-Type':'text/html'});res.end('<html><body>direct</body></html>');
    });
    server.on('upgrade',(req,socket)=>{
      assert.equal(req.headers.cookie,'editor=verified');
      const accept=require('node:crypto').createHash('sha1').update(req.headers['sec-websocket-key']+'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
      socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: '+accept+'\r\n\r\n');
      socket.write(Buffer.from([0x81,2,111,107]));socket.on('data',()=>socket.end());socket.on('error',()=>{});
    });
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
    assert.ok(env.ELECTRON_BIN,'Set ELECTRON_BIN for this optional integration test');
    await new Promise((resolve,reject)=>{
      const child=spawn(env.ELECTRON_BIN,[__filename,'--worker',root,`https://127.0.0.1:${server.address().port}`],{env,stdio:'inherit'});
      const timer=setTimeout(()=>{child.kill();reject(new Error('Electron HTTPS test timed out'));},30000);
      child.on('error',reject);child.on('exit',code=>{clearTimeout(timer);code===0?resolve():reject(new Error('Electron exit '+code));});
    });
    assert.equal(fs.readFileSync(root+'/passed','utf8'),'ok');
  }finally{server?.closeAllConnections();server?.close();fs.rmSync(root,{recursive:true,force:true});}
}
(process.argv.includes('--worker')?worker():main()).catch(e=>{console.error(e);process.exit(1);});
