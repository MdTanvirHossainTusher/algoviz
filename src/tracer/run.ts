import type { Lang, TraceResult } from './types';
import { MAX_STEPS } from './types';

export type Status = 'idle' | 'loading-python' | 'running';

let py: Worker | null = null;
let pyReady: Promise<void> | null = null;

function startPython(onStatus: (s: Status) => void): Promise<void> {
  if (pyReady) return pyReady;
  onStatus('loading-python');
  py = new Worker('/py-worker.js');
  pyReady = new Promise<void>((resolve, reject) => {
    const onMsg = (e: MessageEvent) => {
      if (e.data?.type === 'ready') {
        py!.removeEventListener('message', onMsg);
        resolve();
      } else if (e.data?.type === 'load-error') {
        py!.removeEventListener('message', onMsg);
        reject(new Error(`Could not load the Python runtime (Pyodide): ${e.data.message}`));
      }
    };
    py!.addEventListener('message', onMsg);
    py!.addEventListener('error', () => reject(new Error('Python worker failed to start (are you offline?).')));
  });
  pyReady.catch(() => resetPython());
  return pyReady;
}

function resetPython() {
  py?.terminate();
  py = null;
  pyReady = null;
}

/** Start downloading Pyodide in the background so the first Python run is fast. */
export function warmPython(onStatus: (s: Status) => void) {
  startPython(onStatus)
    .then(() => onStatus('idle'))
    .catch(() => onStatus('idle'));
}

const SOFT_TIMEOUT_S = { python: 10, javascript: 5, cpp: 5, java: 5 };
const HARD_TIMEOUT_MS = { python: 20000, javascript: 9000, cpp: 9000, java: 9000 };

export async function runTrace(lang: Lang, code: string, stdin: string, onStatus: (s: Status) => void): Promise<TraceResult> {
  if (lang === 'python') {
    await startPython(onStatus);
    onStatus('running');
    return new Promise<TraceResult>((resolve) => {
      const w = py!;
      const timer = setTimeout(() => {
        w.removeEventListener('message', onMsg);
        resetPython(); // a stuck interpreter cannot be interrupted, so throw it away
        resolve({ steps: [], stdout: '', error: { msg: 'Execution did not finish in time and was stopped. The Python runtime will reload on the next run.' } });
      }, HARD_TIMEOUT_MS.python);
      const onMsg = (e: MessageEvent) => {
        if (e.data?.type !== 'result') return;
        clearTimeout(timer);
        w.removeEventListener('message', onMsg);
        resolve(e.data.result as TraceResult);
      };
      w.addEventListener('message', onMsg);
      w.postMessage({ type: 'run', code, stdin, maxSteps: MAX_STEPS, timeoutSec: SOFT_TIMEOUT_S.python });
    }).finally(() => onStatus('idle'));
  }

  onStatus('running');
  if (lang === 'cpp' || lang === 'java') {
    return new Promise<TraceResult>((resolve) => {
      const w = new Worker(new URL('./clikeWorker.ts', import.meta.url), { type: 'module' });
      const done = (r: TraceResult) => {
        clearTimeout(timer);
        w.terminate();
        onStatus('idle');
        resolve(r);
      };
      const timer = setTimeout(() => done({ steps: [], stdout: '', error: { msg: 'Execution did not finish in time and was stopped.' } }), HARD_TIMEOUT_MS[lang]);
      w.onmessage = (e: MessageEvent<TraceResult>) => done(e.data);
      w.onerror = (e) => done({ steps: [], stdout: '', error: { msg: e.message || 'The tracer worker crashed.' } });
      w.postMessage({ code, stdin, lang, maxSteps: MAX_STEPS, timeoutMs: SOFT_TIMEOUT_S[lang] * 1000 });
    });
  }
  return new Promise<TraceResult>((resolve) => {
    const w = new Worker(new URL('./jsWorker.ts', import.meta.url), { type: 'module' });
    const done = (r: TraceResult) => {
      clearTimeout(timer);
      w.terminate();
      onStatus('idle');
      resolve(r);
    };
    const timer = setTimeout(() => done({ steps: [], stdout: '', error: { msg: 'Execution did not finish in time and was stopped (an infinite loop inside a single expression?).' } }), HARD_TIMEOUT_MS.javascript);
    w.onmessage = (e: MessageEvent<TraceResult>) => done(e.data);
    w.onerror = (e) => done({ steps: [], stdout: '', error: { msg: e.message || 'The JavaScript worker crashed.' } });
    w.postMessage({ code, stdin, maxSteps: MAX_STEPS, timeoutMs: SOFT_TIMEOUT_S.javascript * 1000 });
  });
}
