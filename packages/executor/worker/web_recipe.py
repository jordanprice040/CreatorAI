"""Reviewed static-web/1 recipe (ADR-0078). This file itself runs only inside Bubblewrap.

It copies the immutable product snapshot, checks the static site's shape, serves `site/` from a
loopback-only HTTP server inside the sandbox's own network namespace, and drives the pinned
headless browser over its DevTools pipe (no sockets, no third-party Python). Each step of the
frozen browser case runs in an isolated JavaScript world, so page scripts cannot replace the
checker's functions. The only output is one browser-qa/1 JSON line on stdout; generated code
runs inside the browser and cannot write to it.
"""
import http.server
import json
import os
import pathlib
import resource
import shutil
import subprocess
import sys
import threading
import time

FORMAT = 'browser-qa/1'
BROWSER = '/opt/browser/chrome-headless-shell'
ALLOWED = {'.html', '.css', '.js', '.mjs', '.json', '.svg', '.txt', '.md'}
MAX_SITE_FILES = 60
LOAD_SECONDS = 10.0
STEP_SECONDS = 3.0
CASE_SECONDS = 40.0
MAX_PAGE_ERRORS = 20

resource.setrlimit(resource.RLIMIT_FSIZE, (8 * 1024 * 1024, 8 * 1024 * 1024))
resource.setrlimit(resource.RLIMIT_NOFILE, (1024, 1024))
assert os.getuid() != 0


def finish(result):
    print(json.dumps(result, sort_keys=True), flush=True)
    sys.exit(0 if result.get('passed') else 1)


class QaError(Exception):
    pass


def check_site():
    """Static files only: site/index.html, known text types, no other top-level code."""
    site = pathlib.Path('site')
    if not (site / 'index.html').is_file():
        raise QaError('The static-site template requires site/index.html')
    files = [p for p in site.rglob('*') if p.is_file()]
    if len(files) > MAX_SITE_FILES:
        raise QaError(f'At most {MAX_SITE_FILES} files under site/')
    for p in files:
        if p.is_symlink() or p.suffix.lower() not in ALLOWED:
            raise QaError('Unsupported file under site/: ' + str(p))
    return site.resolve()


class Handler(http.server.SimpleHTTPRequestHandler):
    """GET/HEAD of site/ only. Requests are recorded so the checker can see what the page asked for."""
    requests = []
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map,
                      '.js': 'text/javascript', '.mjs': 'text/javascript',
                      '.json': 'application/json', '.svg': 'image/svg+xml'}

    def log_message(self, *_args):
        Handler.requests.append(self.path[:200])

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()


class Browser:
    """Minimal DevTools-protocol client over --remote-debugging-pipe (fds 3 and 4)."""

    def __init__(self, profile):
        to_browser_r, self.to_browser = os.pipe()
        self.from_browser, from_browser_w = os.pipe()
        # The child sees its command pipe as fd 3 and its reply pipe as fd 4.
        def remap():
            # Through spare descriptors first, so neither dup2 overwrites the other's source.
            r, w = os.dup(to_browser_r), os.dup(from_browser_w)
            os.dup2(r, 3)
            os.dup2(w, 4)
        self.proc = subprocess.Popen(
            [BROWSER, '--headless', '--no-sandbox', '--remote-debugging-pipe',
             '--user-data-dir=' + profile, '--disable-dev-shm-usage', '--disable-gpu',
             '--no-first-run', '--no-default-browser-check', '--disable-extensions',
             '--disable-background-networking', '--disable-component-update',
             '--disable-sync', '--metrics-recording-only', '--mute-audio',
             '--disable-features=Translate,MediaRouter,OptimizationHints',
             '--window-size=1280,800', 'about:blank'],
            stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            pass_fds=(3, 4), preexec_fn=remap, close_fds=True,
            env={'PATH': '/usr/bin:/bin', 'HOME': '/tmp/home', 'TMPDIR': '/tmp'})
        os.close(to_browser_r)
        os.close(from_browser_w)
        self.buffer = b''
        self.next_id = 0
        self.side_id = 1 << 30
        self.events = []
        self.session = None
        self.dialogs = []
        self.workers = []
        self.navigations = 0
        self.main_frame = None
        self.page_url = ''
        self.unsupported = []

    def _post(self, method, params, session):
        # Fire-and-forget command (its reply is ignored), used while handling an event.
        self.side_id += 1
        os.write(self.to_browser, json.dumps({'id': self.side_id, 'method': method,
                                              'params': params, 'sessionId': session}).encode() + b'\0')

    def _handle(self, event):
        """Events the checker must answer at once, wherever they arrive."""
        m, p = event.get('method'), event.get('params', {})
        if m == 'Target.attachedToTarget':
            # Workers start paused (waitForDebuggerOnStart): record their requests and errors
            # before they run, and attach to any worker they start in turn.
            kind = p.get('targetInfo', {}).get('type', '')
            if kind == 'page':
                return  # the checker's own page session (attached explicitly below)
            self.workers.append(kind)
            sid = p['sessionId']
            for method, params in (('Network.enable', {}), ('Runtime.enable', {}),
                                   ('Target.setAutoAttach', {'autoAttach': True, 'waitForDebuggerOnStart': True,
                                                             'flatten': True}),
                                   ('Runtime.runIfWaitingForDebugger', {})):
                self._post(method, params, sid)
        elif m == 'Page.frameNavigated' and not p.get('frame', {}).get('parentId'):
            self.navigations += 1
            self.page_url = p['frame'].get('url', '')
        elif m == 'Page.frameRequestedNavigation' and p.get('frameId') == self.main_frame:
            # Seen when the page starts leaving, before the new document commits, so a late
            # navigation cannot slip past the last step. A #hash change stays on the page.
            same = p.get('url', '').split('#')[0] == self.page_url.split('#')[0]
            if not same or not p.get('reason', '').startswith('scriptInitiated') and \
                    p.get('reason') != 'anchorClick':
                self.navigations += 1
        elif m == 'Target.targetCreated' and p.get('targetInfo', {}).get('type') in (
                'service_worker', 'shared_worker'):
            self.unsupported.append(p['targetInfo']['type'].replace('_', ' '))
        elif m == 'Page.javascriptDialogOpening':
            # Nobody answers a dialog in QA: dismiss it, and fail the case with that reason.
            self.dialogs.append(p.get('type', 'dialog'))
            self._post('Page.handleJavaScriptDialog', {'accept': False}, event.get('sessionId'))

    def _read(self, deadline):
        import select
        while b'\0' not in self.buffer:
            wait = deadline - time.monotonic()
            if wait <= 0:
                raise QaError('The browser did not answer in time')
            ready, _, _ = select.select([self.from_browser], [], [], wait)
            if ready:
                chunk = os.read(self.from_browser, 1 << 16)
                if not chunk:
                    raise QaError('The browser exited')
                self.buffer += chunk
        message, self.buffer = self.buffer.split(b'\0', 1)
        message = json.loads(message)
        if 'method' in message:
            self._handle(message)
        return message

    def send(self, method, params=None, session=True, timeout=STEP_SECONDS + 2):
        self.next_id += 1
        message = {'id': self.next_id, 'method': method, 'params': params or {}}
        if session and self.session:
            message['sessionId'] = self.session
        os.write(self.to_browser, json.dumps(message).encode() + b'\0')
        deadline = time.monotonic() + timeout
        while True:
            reply = self._read(deadline)
            if reply.get('id') == self.next_id:
                if 'error' in reply:
                    raise QaError(method + ': ' + str(reply['error'].get('message'))[:200])
                return reply.get('result', {})
            self.events.append(reply)

    def wait_event(self, method, timeout):
        deadline = time.monotonic() + timeout
        while True:
            for i, e in enumerate(self.events):
                if e.get('method') == method:
                    return self.events.pop(i)
            self.events.append(self._read(deadline))

    def close(self):
        try:
            self.send('Browser.close', session=False, timeout=2)
        except Exception:
            pass
        try:
            self.proc.wait(timeout=3)
        except subprocess.TimeoutExpired:
            self.proc.kill()
            self.proc.wait()


# Runs in the isolated world. Element lookup and reading never use page-defined functions.
HELPERS = r"""
(() => {
  const norm = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
  const one = (sel) => {
    const all = document.querySelectorAll(sel);
    if (all.length === 0) return { error: 'no element matches ' + sel };
    if (all.length > 1) return { error: all.length + ' elements match ' + sel + '; use a unique selector' };
    return { el: all[0] };
  };
  const visible = (el) => {
    if (!el.isConnected) return false;
    const s = getComputedStyle(el);
    if (s.visibility === 'hidden' || s.display === 'none') return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const text = (el) => ('value' in el && ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName))
    ? norm(el.value) : norm(el.innerText ?? el.textContent);
  return { norm, one, visible, text };
})()
"""


# Runs in the page's main world before its own scripts, in every frame. QA has no network at all;
# this makes a WebRTC attempt visible as an outside request instead of a silent failure.
BINDING = 'creatorQaBlocked'
NO_WEBRTC = r"""
(() => {
  const report = globalThis.creatorQaBlocked;
  for (const name of ['RTCPeerConnection', 'webkitRTCPeerConnection', 'RTCDataChannel',
                      'RTCSessionDescription', 'RTCIceCandidate']) {
    if (!(name in globalThis)) continue;
    const blocked = function () {
      try { report && report('webrtc:' + name); } catch (e) {}
      throw new TypeError(name + ' is not available in static-web/1 QA');
    };
    try { Object.defineProperty(globalThis, name, { value: blocked, configurable: false, writable: false }); }
    catch (e) {}
  }
})();
"""


def evaluate(b, context, expression):
    r = b.send('Runtime.evaluate', {'expression': expression, 'contextId': context,
                                    'returnByValue': True, 'awaitPromise': True})
    if 'exceptionDetails' in r:
        raise QaError('checker script failed: ' + str(r['exceptionDetails'].get('text'))[:200])
    return r.get('result', {}).get('value')


def interruption(b, loaded):
    if b.dialogs:
        return ('the page opened a dialog (' + b.dialogs[0] + '); QA dismisses dialogs and fails the case '
                '(show messages in the page instead of alert/confirm/prompt)')
    return ('the page loaded another document (a form submitted without preventDefault, a link or a '
            'location change); a case stays on one page, and goto changes only #routes')


def run_step(b, context, step):
    """One frozen step; expectations wait up to STEP_SECONDS for the page to settle."""
    action = step['action']
    sel = json.dumps(step.get('selector', ''))
    deadline = time.monotonic() + STEP_SECONDS
    last = 'not checked'
    while True:
        if action in ('click', 'fill', 'select', 'press', 'check'):
            probe = evaluate(b, context, f"""(() => {{ const h = {HELPERS};
              const f = h.one({sel}); if (f.error) return {{ error: f.error }};
              if (!h.visible(f.el)) return {{ error: 'element is not visible: ' + {sel} }};
              if (f.el.disabled) return {{ error: 'element is disabled: ' + {sel} }};
              f.el.scrollIntoView({{ block: 'center' }}); f.el.focus();
              const r = f.el.getBoundingClientRect();
              return {{ x: r.left + r.width / 2, y: r.top + r.height / 2, tag: f.el.tagName }}; }})()""")
            if probe and 'error' not in probe:
                if action in ('click', 'check'):
                    for kind in ('mousePressed', 'mouseReleased'):
                        b.send('Input.dispatchMouseEvent', {'type': kind, 'x': probe['x'], 'y': probe['y'],
                                                            'button': 'left', 'clickCount': 1})
                elif action == 'fill':
                    # Cleared, then typed through the browser's input pipeline, so page listeners
                    # see real input events.
                    evaluate(b, context, f"""(() => {{ const h = {HELPERS}; const el = h.one({sel}).el;
                      el.value = ''; el.dispatchEvent(new Event('input', {{ bubbles: true }})); }})()""")
                    if step['value']:
                        b.send('Input.insertText', {'text': step['value']})
                    evaluate(b, context, f"""(() => {{ const h = {HELPERS}; const el = h.one({sel}).el;
                      el.dispatchEvent(new Event('change', {{ bubbles: true }})); }})()""")
                elif action == 'select':
                    value = json.dumps(step['value'])
                    ok = evaluate(b, context, f"""(() => {{ const h = {HELPERS}; const el = h.one({sel}).el;
                      if (el.tagName !== 'SELECT') return 'not a select element';
                      if (![...el.options].some((o) => o.value === {value})) return 'no option with value ' + {value};
                      el.value = {value}; el.dispatchEvent(new Event('input', {{ bubbles: true }}));
                      el.dispatchEvent(new Event('change', {{ bubbles: true }})); return true; }})()""")
                    if ok is not True:
                        return False, str(ok)
                elif action == 'press':
                    key = step['key']
                    codes = {'Enter': 13, 'Tab': 9, 'Escape': 27, 'Space': 32, 'ArrowUp': 38,
                             'ArrowDown': 40, 'ArrowLeft': 37, 'ArrowRight': 39, 'Backspace': 8}
                    k = ' ' if key == 'Space' else key
                    base = {'key': k, 'code': key, 'windowsVirtualKeyCode': codes[key]}
                    b.send('Input.dispatchKeyEvent', {**base, 'type': 'keyDown',
                                                      **({'text': '\r'} if key == 'Enter' else
                                                         {'text': ' '} if key == 'Space' else {})})
                    b.send('Input.dispatchKeyEvent', {**base, 'type': 'keyUp'})
                return True, 'done'
            last = (probe or {}).get('error', 'element not found')
        elif action == 'goto':
            target = json.dumps(step['path'])
            evaluate(b, context, f"location.hash = {target}.startsWith('#') ? {target} : location.hash")
            return True, 'done'
        else:
            want = json.dumps(step.get('text', ''))
            count = int(step.get('count', 0))
            verdict = evaluate(b, context, f"""(() => {{ const h = {HELPERS}; const a = {json.dumps(action)};
              if (a === 'expect_count') {{ const n = document.querySelectorAll({sel}).length;
                return n === {count} ? true : 'found ' + n + ' matching elements, expected {count}'; }}
              if (a === 'expect_title') {{ return h.norm(document.title) === h.norm({want}) ? true
                : 'title is ' + JSON.stringify(h.norm(document.title)); }}
              const f = h.one({sel});
              if (a === 'expect_hidden') return f.error && f.error.startsWith('no element') ? true
                : f.error ? f.error : (!h.visible(f.el) ? true : 'element is visible');
              if (f.error) return f.error;
              if (a === 'expect_visible') return h.visible(f.el) ? true : 'element is not visible';
              const t = h.text(f.el), w = h.norm({want});
              if (a === 'expect_text') return t === w ? true : 'text is ' + JSON.stringify(t.slice(0, 200));
              if (a === 'expect_contains') return t.includes(w) ? true : 'text is ' + JSON.stringify(t.slice(0, 200));
              return 'unknown step'; }})()""")
            if verdict is True:
                return True, 'passed'
            last = str(verdict)
        if time.monotonic() >= deadline:
            return False, last[:300]
        time.sleep(0.1)


def main():
    started = time.monotonic()
    shutil.copytree('/input', '/work/product')
    os.chdir('/work/product')
    case = json.loads(pathlib.Path('/acceptance.json').read_text()) \
        if pathlib.Path('/acceptance.json').is_file() else {'page': '/', 'steps': []}
    if set(case) != {'page', 'steps'}:
        raise QaError('Only the frozen page and steps may enter the sandbox')
    site = check_site()
    server = http.server.ThreadingHTTPServer(
        ('127.0.0.1', 0), lambda *a: Handler(*a, directory=str(site)))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    origin = f'http://127.0.0.1:{server.server_address[1]}'
    os.makedirs('/tmp/home', exist_ok=True)
    b = Browser('/tmp/profile')
    result = {'format': FORMAT, 'passed': False, 'steps': [], 'page_errors': [],
              'outbound': [], 'reason': None}
    try:
        version = b.send('Browser.getVersion', session=False, timeout=LOAD_SECONDS)
        result['browser'] = version.get('product')
        target = b.send('Target.createTarget', {'url': 'about:blank'}, session=False)
        b.main_frame = target['targetId']  # a page's main frame id is its target id
        b.session = b.send('Target.attachToTarget', {'targetId': target['targetId'], 'flatten': True},
                           session=False)['sessionId']
        b.send('Target.setDiscoverTargets', {'discover': True}, session=False)
        for domain in ('Page', 'Runtime', 'Network'):
            b.send(domain + '.enable')
        b.send('Target.setAutoAttach', {'autoAttach': True, 'waitForDebuggerOnStart': True, 'flatten': True})
        b.send('Runtime.addBinding', {'name': BINDING})
        b.send('Page.addScriptToEvaluateOnNewDocument', {'source': NO_WEBRTC})
        b.send('Page.navigate', {'url': origin + case['page']}, timeout=LOAD_SECONDS)
        b.wait_event('Page.loadEventFired', LOAD_SECONDS)
        loaded = b.navigations
        frame = b.send('Page.getFrameTree')['frameTree']['frame']['id']
        context = b.send('Page.createIsolatedWorld', {'frameId': frame, 'worldName': 'creator-qa'})['executionContextId']
        ok = True
        for i, step in enumerate(case['steps']):
            if time.monotonic() - started > CASE_SECONDS:
                result['reason'] = 'case time limit'
                ok = False
                break
            if b.dialogs or b.navigations > loaded:
                passed, detail = False, interruption(b, loaded)
            else:
                try:
                    passed, detail = run_step(b, context, step)
                except QaError:
                    # A new document destroys the checker's isolated world mid-step.
                    if not (b.dialogs or b.navigations > loaded):
                        raise
                    passed = False
                if b.dialogs or b.navigations > loaded:
                    passed, detail = False, interruption(b, loaded)
            result['steps'].append({'index': i, 'passed': passed, 'detail': detail})
            if not passed:
                ok = False
                result['reason'] = f'step {i + 1} ({step["action"]}) failed' + (
                    ': ' + detail.split(';')[0] if b.dialogs or b.navigations > loaded else '')
                break
        time.sleep(0.2)
        try:
            b.send('Runtime.evaluate', {'expression': '0'}, timeout=2)
        except QaError:
            pass
        if ok and (b.dialogs or b.navigations > loaded):
            # Started after the last step's check passed.
            ok = False
            result['reason'] = 'after the last step: ' + interruption(b, loaded).split(';')[0]
        for e in b.events:
            m, p = e.get('method'), e.get('params', {})
            if m == 'Runtime.exceptionThrown' and len(result['page_errors']) < MAX_PAGE_ERRORS:
                d = p.get('exceptionDetails', {})
                result['page_errors'].append(
                    str((d.get('exception') or {}).get('description') or d.get('text'))[:300])
            # From the page and from every worker session (auto-attached above).
            if m == 'Network.requestWillBeSent':
                url = p.get('request', {}).get('url', '')
                if not (url.startswith(origin + '/') or url.startswith(('data:', 'blob:', 'about:'))):
                    result['outbound'].append(url[:200])
            if m == 'Network.webSocketCreated':
                result['outbound'].append('websocket ' + p.get('url', '')[:190])
            if m == 'Runtime.bindingCalled' and p.get('name') == BINDING:
                result['outbound'].append(str(p.get('payload', 'webrtc'))[:200])
        for kind in b.unsupported:
            result['outbound'].append(kind + ' (not supported by static-web/1)')
        result['workers'] = b.workers[:20]
        if b.dialogs:
            result['reason'] = result['reason'] or 'the page opened a dialog'
        if result['page_errors']:
            result['reason'] = result['reason'] or 'uncaught page error'
        if result['outbound']:
            result['reason'] = result['reason'] or 'request outside the site'
        result['passed'] = ok and not result['page_errors'] and not result['outbound'] and not b.dialogs \
            and len(result['steps']) == len(case['steps'])
        result['site_requests'] = Handler.requests[:50]
    except QaError as e:
        result['reason'] = str(e)[:500]
    finally:
        b.close()
        server.shutdown()
    finish(result)


if __name__ == '__main__':
    try:
        main()
    except QaError as e:
        finish({'format': FORMAT, 'passed': False, 'steps': [], 'page_errors': [], 'outbound': [],
                'reason': str(e)[:500]})
