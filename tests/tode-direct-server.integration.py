"""Exercise the installed native code-server in disposable state, not a mock server."""
import base64
import importlib.machinery
import importlib.util
import json
import os
from pathlib import Path
import signal
import socket
import ssl
import subprocess
import tempfile
import time
import urllib.error
import urllib.request
import uuid

repo = Path(__file__).resolve().parents[1]
loader = importlib.machinery.SourceFileLoader('launcher', str(repo/'scripts/tode-remote'))
spec = importlib.util.spec_from_loader('launcher', loader)
launcher = importlib.util.module_from_spec(spec); loader.exec_module(launcher)
cs = Path(os.environ['SHELLOS_TEST_CODE_SERVER'])
with tempfile.TemporaryDirectory(prefix='shellos-native-https-') as tmp:
    root = Path(tmp)
    subprocess.run(['openssl','req','-x509','-newkey','rsa:2048','-nodes','-days','1',
                    '-subj','/CN=localhost','-addext','subjectAltName=IP:127.0.0.1',
                    '-keyout',str(root/'key'),'-out',str(root/'cert')],check=True,capture_output=True)
    with socket.socket() as probe:
        probe.bind(('127.0.0.1',0)); port=probe.getsockname()[1]
    config={'bind-addr':f'127.0.0.1:{port}', 'auth':'password','password':uuid.uuid4().hex,
            'cert':str(root/'cert'),'cert-key':str(root/'key'),
            'user-data-dir':str(root/'data'),'extensions-dir':str(root/'extensions'),
            'disable-proxy':True, 'disable-telemetry':True,'disable-update-check':True}
    (root/'config.json').write_text(json.dumps(config));(root/'config.json').chmod(0o600)
    with (root/'server.log').open('wb') as log:
        process=subprocess.Popen([str(cs),'--config',str(root/'config.json')],stdout=log,stderr=log,start_new_session=True)
    try:
        origin=f'https://127.0.0.1:{port}'
        context=ssl.create_default_context(cafile=str(root/'cert'))
        class NoRedirect(urllib.request.HTTPRedirectHandler):
            def redirect_request(self,*args,**kwargs): return None
        opener=urllib.request.build_opener(urllib.request.ProxyHandler({}),NoRedirect(),urllib.request.HTTPSHandler(context=context))
        for _ in range(80):
            try:
                with opener.open(origin+'/healthz',timeout=1) as response: assert response.status==200
                break
            except (OSError,urllib.error.URLError): time.sleep(.25)
        else: raise RuntimeError('native HTTPS did not start: '+(root/'server.log').read_text())
        try: opener.open(origin+'/',timeout=5)
        except urllib.error.HTTPError as error: assert error.code==302 and '/login' in error.headers['Location']
        else: raise AssertionError('Unauthenticated root was accepted')
        cookie=launcher.login({'origin':origin,'certificate':(root/'cert').read_text(),'password':config['password']})
        request=urllib.request.Request(origin+'/?folder='+tmp,headers={'Cookie':cookie})
        with opener.open(request,timeout=20) as response:
            html=response.read().decode();assert response.status==200 and 'workbench' in html
        request=urllib.request.Request(origin+'/proxy/1234/',headers={'Cookie':cookie})
        try: opener.open(request,timeout=5)
        except urllib.error.HTTPError as error: assert error.code==403
        else: raise AssertionError('General port proxy is still enabled')
        with socket.create_connection(('127.0.0.1',port),timeout=10) as raw:
            with context.wrap_socket(raw,server_hostname='127.0.0.1') as sock:
                key=base64.b64encode(os.urandom(16)).decode()
                request=(f'GET /?reconnectionToken={uuid.uuid4()}&reconnection=false&skipWebSocketFrames=false HTTP/1.1\r\n'
                         f'Host: 127.0.0.1:{port}\r\nOrigin: {origin}\r\nCookie: {cookie}\r\n'
                         f'Connection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: {key}\r\n\r\n')
                sock.sendall(request.encode());response=sock.recv(4096)
                assert b'101 Switching Protocols' in response,response[:150]
        print('Native HTTPS: certificate verified, unauthenticated denied, login/workbench/WSS passed, port proxy disabled')
    finally:
        os.killpg(process.pid,signal.SIGTERM)
        process.wait(timeout=10)
