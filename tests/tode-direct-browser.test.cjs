const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const {execFileSync} = require('node:child_process');
const {configure} = require('../scripts/tode-direct-browser.cjs');
test('certificate pin and credentials stay scoped to the editor origin, including WebSockets', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shellos-cert-test-'));
  try {
    execFileSync('openssl', ['req','-x509','-newkey','rsa:2048','-nodes','-days','1','-subj','/CN=localhost','-keyout',dir+'/key','-out',dir+'/cert'], {stdio:'ignore'});
    const cert = fs.readFileSync(dir+'/cert','utf8');
    let verify, intercept, filter;
    const electron={session:{fromPartition: p => {assert.equal(p,'persist:test-direct');return {
      setProxy: opts => {assert.deepEqual(opts,{mode:'direct'});return Promise.resolve();},
      setCertificateVerifyProc:f=>verify=f,webRequest:{
        onBeforeRequest: () => {},
        onBeforeSendHeaders:(q,f)=>{filter=q;intercept=f;}
      }
    };}}};
    configure({origin:'https://127.0.0.1:8791',partition:'persist:test-direct',certificate:cert,cookie:'session=private'},electron);
    verify({hostname:'127.0.0.1',certificate:{data:cert}},r=>assert.equal(r,0));
    verify({hostname:'127.0.0.1',certificate:{data:'invalid'}},r=>assert.equal(r,-2));
    verify({hostname:'example.org',certificate:{data:cert}},r=>assert.equal(r,-3));
    assert.ok(filter.urls.includes('wss://127.0.0.1:8791/*'));
    for(const url of ['https://127.0.0.1:8791/','wss://127.0.0.1:8791/'])
      intercept({url,requestHeaders:{}},r=>assert.equal(r.requestHeaders.Cookie,'session=private'));
    for(const url of ['https://example.org/','https://127.0.0.1:9999/','http://127.0.0.1:8791/'])
      intercept({url,requestHeaders:{}},r=>assert.equal(r.requestHeaders.Cookie,undefined));
  } finally { fs.rmSync(dir,{recursive:true,force:true}); }
});
