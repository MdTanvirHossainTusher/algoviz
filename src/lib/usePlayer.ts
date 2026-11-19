import { useCallback, useEffect, useRef, useState } from 'react';

export const SPEEDS = [0.25, 0.5, 1, 1.5, 2, 4, 8];
const BASE_MS = 750;

/** Step-through playback state shared by the algorithm page and the code tracer. */
export function usePlayer(length: number, resetKey: unknown, autoplay = true) {
  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(autoplay);
  const [speed, setSpeed] = useState(1);
  const lenRef = useRef(length);
  lenRef.current = length;

  useEffect(() => {
    setIdx(0);
    setPlaying(autoplay && length > 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey]);

  useEffect(() => {
    if (!playing) return;
    if (idx >= length - 1) {
      setPlaying(false);
      return;
    }
    const t = setTimeout(() => setIdx((i) => Math.min(i + 1, lenRef.current - 1)), BASE_MS / speed);
    return () => clearTimeout(t);
  }, [playing, idx, speed, length]);

  const next = useCallback(() => {
    setPlaying(false);
    setIdx((i) => Math.min(i + 1, lenRef.current - 1));
  }, []);
  const prev = useCallback(() => {
    setPlaying(false);
    setIdx((i) => Math.max(i - 1, 0));
  }, []);
  const replay = useCallback(() => {
    setIdx(0);
    setPlaying(true);
  }, []);
  const toggle = useCallback(() => {
    setPlaying((p) => {
      if (!p && idx >= lenRef.current - 1) {
        setIdx(0);
        return true;
      }
      return !p;
    });
  }, [idx]);
  const seek = useCallback((i: number) => {
    setPlaying(false);
    setIdx(Math.max(0, Math.min(i, lenRef.current - 1)));
  }, []);

  return { idx: Math.min(idx, Math.max(0, length - 1)), playing, speed, setSpeed, next, prev, replay, toggle, seek };
}

/** ←/→ step, Space play/pause, R replay — ignored while typing in a form field. */
export function usePlayerKeys(p: ReturnType<typeof usePlayer>, enabled = true) {
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.closest('input, textarea, select, [contenteditable="true"], .cm-editor')) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === 'ArrowRight') p.next();
      else if (e.key === 'ArrowLeft') p.prev();
      else if (e.key === ' ') p.toggle();
      else if (e.key.toLowerCase() === 'r') p.replay();
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [p, enabled]);
}
