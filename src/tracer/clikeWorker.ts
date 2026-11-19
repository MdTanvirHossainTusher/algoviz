/// <reference lib="webworker" />
import { traceCLike } from './clike';
import type { TraceResult } from './types';

interface RunMsg {
  code: string;
  stdin: string;
  lang: 'cpp' | 'java';
  maxSteps: number;
  timeoutMs: number;
}

self.onmessage = (e: MessageEvent<RunMsg>) => {
  const { code, stdin, lang, maxSteps, timeoutMs } = e.data;
  const result: TraceResult = traceCLike(code, lang, { stdin, maxSteps, timeoutMs });
  self.postMessage(result);
};
