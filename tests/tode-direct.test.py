import importlib.machinery
import importlib.util
import json
import os
from pathlib import Path
import ssl
import subprocess
import tempfile
import threading
import unittest
from http.server import HTTPServer, BaseHTTPRequestHandler
from unittest.mock import patch

REPO = Path(__file__).resolve().parents[1]


def load(name, path):
    loader = importlib.machinery.SourceFileLoader(name, str(REPO / path))
    spec = importlib.util.spec_from_loader(name, loader)
    module = importlib.util.module_from_spec(spec)
    loader.exec_module(module)
    return module


launcher = load('direct_launcher', 'scripts/tode-remote')
server = load('direct_server', 'scripts/tode-direct-server.py')
kitty = load('kitty_config', 'scripts/configure-kitty-ssh.py')


class DirectTests(unittest.TestCase):
    def test_kitty_preserves_private_aliases_and_never_reenables_forwarding(self):
        original = 'hostname example\nlogin_shell zsh\nforward_remote_control yes\n'
        result = kitty.configure(original)
        self.assertIn('hostname example\nlogin_shell zsh', result)
        self.assertNotIn('forward_remote_control yes', result)
        self.assertEqual(kitty.configure(result), result)

    def test_ssh_cannot_inherit_forwarding_and_quotes_project(self):
        folder = "/tmp/a'; touch SHOULD_NOT_EXIST; '"
        with patch.object(launcher.subprocess, 'run') as run:
            run.return_value.stdout = '{}'
            launcher.remote_info('example', 8791, folder)
            command = run.call_args.args[0]
            for option in ['ForwardAgent=no', 'ClearAllForwardings=yes', 'ProxyCommand=none',
                           'ProxyJump=none', 'ControlMaster=no', 'ControlPath=none']:
                self.assertIn(option, command)
            self.assertTrue(command[-1].endswith(launcher.shlex.quote(folder)))
        with self.assertRaises(ValueError):
            launcher.remote_info('-R', 8791, '~')

    def test_addresses_come_from_authenticated_ssh(self):
        with patch.dict(os.environ, {'SSH_CONNECTION': '192.0.2.2 1234 192.0.2.3 22'}):
            self.assertEqual(server.ssh_addresses(), ('192.0.2.2', '192.0.2.3'))
        with patch.dict(os.environ, {'SSH_CONNECTION': ''}):
            with self.assertRaises(ValueError):
                server.ssh_addresses()

    def test_firewall_does_not_open_other_ports_or_override_host_rules(self):
        with patch.object(server.subprocess, 'run') as sub, patch.object(server, 'run') as run:
            sub.return_value.returncode = 1
            server.restrict_source('192.0.2.3', '192.0.2.2', 8791)
            calls = [c.args for c in run.call_args_list]
            self.assertIn(('/usr/sbin/iptables', '-w', '-A', 'SHTODE8791', '-j', 'REJECT', '--reject-with', 'tcp-reset'), calls)
            self.assertTrue(any(c[-7:] == ('tcp', '-d', '192.0.2.3', '--dport', '8791', '-j', 'SHTODE8791') for c in calls))
            self.assertFalse(any('ACCEPT' in c or '-F' in c or '-P' in c for c in calls))

    def test_tls_login_checks_certificate_and_hostname(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            for name, ip in [('server', '127.0.0.1'), ('other', '127.0.0.2')]:
                subprocess.run(['openssl','req','-x509','-newkey','rsa:2048','-nodes','-days','1',
                                '-subj','/CN=direct-test','-addext',f'subjectAltName=IP:{ip}',
                                '-keyout',str(root/f'{name}.key'),'-out',str(root/f'{name}.crt')],
                               check=True, capture_output=True)
            class Login(BaseHTTPRequestHandler):
                def do_POST(self):
                    body = self.rfile.read(int(self.headers['Content-Length']))
                    self.send_response(302 if body == b'password=test-pass' else 401)
                    if body == b'password=test-pass':
                        self.send_header('Set-Cookie', 'editor-session=test-cookie; Secure; HttpOnly')
                    self.end_headers()
                def log_message(self, *args):
                    pass
            http = HTTPServer(('127.0.0.1', 0), Login)
            context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
            context.load_cert_chain(root/'server.crt',root/'server.key')
            http.socket = context.wrap_socket(http.socket, server_side=True)
            thread = threading.Thread(target=http.serve_forever,daemon=True); thread.start()
            try:
                info={'origin':f'https://127.0.0.1:{http.server_port}', 'certificate':(root/'server.crt').read_text(), 'password':'test-pass'}
                self.assertEqual(launcher.login(info), 'editor-session=test-cookie')
                with self.assertRaises(ssl.SSLCertVerificationError):
                    launcher.login({**info,'certificate':(root/'other.crt').read_text()})
                with self.assertRaises(RuntimeError):
                    launcher.login({**info,'password':'wrong'})
            finally:
                http.shutdown();http.server_close();thread.join()


if __name__ == '__main__':
    unittest.main()
