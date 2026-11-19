/* Python tracer: runs user code in Pyodide with sys.settrace and returns one snapshot per line event. */
/* global importScripts, loadPyodide */
importScripts('https://cdn.jsdelivr.net/pyodide/v0.27.2/full/pyodide.js');

const TRACER = String.raw`
import sys, io, json, math, types, collections, builtins

def __at_run(src, stdin_text, max_steps, time_limit):
    import time
    steps = []
    out = io.StringIO()
    deadline = time.time() + time_limit
    state = {'timed_out': False}

    def enc(v, depth=0, seen=frozenset()):
        if v is None:
            return {'t': 'none', 'v': 'None'}
        if isinstance(v, bool):
            return {'t': 'bool', 'v': v}
        if isinstance(v, int):
            return {'t': 'num', 'v': v} if abs(v) < 2**53 else {'t': 'other', 'repr': str(v)}
        if isinstance(v, float):
            return {'t': 'num', 'v': v} if math.isfinite(v) else {'t': 'other', 'repr': repr(v)}
        if isinstance(v, str):
            return {'t': 'str', 'v': v if len(v) <= 200 else v[:200] + '…'}
        if isinstance(v, (types.FunctionType, types.BuiltinFunctionType, types.MethodType, type)):
            return {'t': 'fn', 'name': getattr(v, '__name__', '?')}
        if id(v) in seen:
            return {'t': 'ref', 'label': '↺ cycle'}
        if depth > 4:
            return {'t': 'ref', 'label': '…'}
        s2 = seen | {id(v)}
        if isinstance(v, (list, tuple, collections.deque)):
            kind = 'tuple' if isinstance(v, tuple) else 'deque' if isinstance(v, collections.deque) else 'list'
            items = list(v)
            return {'t': 'list', 'kind': kind, 'items': [enc(x, depth + 1, s2) for x in items[:60]], 'more': max(0, len(items) - 60)}
        if isinstance(v, (set, frozenset)):
            try:
                items = sorted(v)
            except Exception:
                items = list(v)
            return {'t': 'list', 'kind': 'set', 'items': [enc(x, depth + 1, s2) for x in items[:60]], 'more': max(0, len(items) - 60)}
        if isinstance(v, dict):
            items = list(v.items())
            kind = 'defaultdict' if isinstance(v, collections.defaultdict) else 'Counter' if isinstance(v, collections.Counter) else 'dict'
            return {'t': 'dict', 'kind': kind, 'entries': [[repr(k), enc(x, depth + 1, s2)] for k, x in items[:40]], 'more': max(0, len(items) - 40)}
        if isinstance(v, types.ModuleType):
            return None
        if isinstance(v, BaseException):
            return {'t': 'other', 'repr': repr(v)}
        d = getattr(v, '__dict__', None)
        if isinstance(d, dict):
            items = [(k, x) for k, x in d.items() if not k.startswith('__')]
            return {'t': 'dict', 'kind': 'object', 'cls': type(v).__name__, 'entries': [[k, enc(x, depth + 1, s2)] for k, x in items[:30]], 'more': max(0, len(items) - 30)}
        r = repr(v)
        return {'t': 'other', 'repr': r if len(r) <= 120 else r[:120] + '…'}

    def frame_vars(f, is_module):
        src_vars = f.f_globals if is_module else f.f_locals
        res = {}
        for k, x in list(src_vars.items()):
            if k.startswith('__') or (is_module and k == 'input'):
                continue
            e = enc(x)
            if e is not None:
                res[k] = e
        return res

    def snapshot(frame):
        frames = []
        f = frame
        while f is not None:
            if f.f_code.co_filename == '<user>':
                name = f.f_code.co_name
                is_module = name == '<module>'
                frames.append({'name': 'global' if is_module else name, 'line': f.f_lineno, 'locals': frame_vars(f, is_module)})
            f = f.f_back
        frames.reverse()
        return frames

    class StopTrace(BaseException):
        pass

    unwinding = {}   # frame id -> error message while an exception travels up

    def tracer(frame, event, arg):
        if frame.f_code.co_filename != '<user>':
            return None
        if event in ('call', 'line', 'return', 'exception'):
            if event == 'call' and frame.f_code.co_name == '<module>':
                return tracer
            if len(steps) >= max_steps:
                raise StopTrace()
            if time.time() > deadline:
                state['timed_out'] = True
                raise StopTrace()
            fid = id(frame)
            st = {'line': frame.f_lineno, 'event': event, 'frames': snapshot(frame), 'stdout': out.getvalue()[-6000:]}
            if event == 'line':
                unwinding.pop(fid, None)        # the exception was caught inside this frame
            if event == 'return':
                if fid in unwinding:
                    # Python reports "return None" while an exception unwinds the frame — show it as propagation
                    st['event'] = 'exception'
                    st['error'] = '%s (propagating out of %s)' % (unwinding.pop(fid), 'the program' if frame.f_code.co_name == '<module>' else frame.f_code.co_name + '()')
                else:
                    rv = enc(arg)
                    st['ret'] = rv if rv is not None else {'t': 'other', 'repr': '<module>'}
            if event == 'exception':
                if issubclass(arg[0], StopTrace):
                    return tracer
                st['error'] = '%s: %s' % (arg[0].__name__, arg[1])
                unwinding[fid] = st['error']
            steps.append(st)
        return tracer

    lines = iter(stdin_text.split('\n'))
    def fake_input(prompt=''):
        if prompt:
            out.write(str(prompt))
        try:
            return next(lines)
        except StopIteration:
            raise EOFError('EOF when reading a line (add more lines to the stdin box)')

    g = {'__name__': '__main__', '__builtins__': builtins, 'input': fake_input}
    err = None
    truncated = False
    old_out, old_in, old_rl = sys.stdout, sys.stdin, sys.getrecursionlimit()
    sys.stdout = out
    sys.stdin = io.StringIO(stdin_text)
    sys.setrecursionlimit(600)
    try:
        code = compile(src, '<user>', 'exec')
        sys.settrace(tracer)
        try:
            exec(code, g)
        finally:
            sys.settrace(None)
    except StopTrace:
        truncated = True
    except SyntaxError as e:
        err = {'msg': 'SyntaxError: %s' % e.msg, 'line': e.lineno}
    except BaseException as e:
        line = None
        tb = e.__traceback__
        while tb is not None:
            if tb.tb_frame.f_code.co_filename == '<user>':
                line = tb.tb_lineno
            tb = tb.tb_next
        err = {'msg': '%s: %s' % (type(e).__name__, e), 'line': line}
    finally:
        sys.stdout, sys.stdin = old_out, old_in
        sys.setrecursionlimit(old_rl)
    if truncated and state['timed_out']:
        err = {'msg': 'Stopped after %ds — possible infinite loop or very long run.' % time_limit, 'line': steps[-1]['line'] if steps else None}
    return json.dumps({'steps': steps, 'error': err, 'truncated': truncated, 'stdout': out.getvalue()})
`;

let pyodide = null;
const ready = (async () => {
  pyodide = await loadPyodide({ indexURL: 'https://cdn.jsdelivr.net/pyodide/v0.27.2/full/' });
  pyodide.runPython(TRACER);
  self.postMessage({ type: 'ready' });
})().catch((e) => self.postMessage({ type: 'load-error', message: String(e && e.message ? e.message : e) }));

self.onmessage = async (e) => {
  const msg = e.data;
  if (msg.type !== 'run') return;
  await ready;
  try {
    const run = pyodide.globals.get('__at_run');
    const json = run(msg.code, msg.stdin, msg.maxSteps, msg.timeoutSec);
    run.destroy();
    self.postMessage({ type: 'result', result: JSON.parse(json) });
  } catch (err) {
    self.postMessage({ type: 'result', result: { steps: [], stdout: '', error: { msg: String(err && err.message ? err.message : err) } } });
  }
};
