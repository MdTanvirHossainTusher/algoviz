import type { usePlayer } from '../lib/usePlayer';
import { SPEEDS } from '../lib/usePlayer';
import { IconNext, IconPause, IconPlay, IconPrev, IconReplay } from './Icons';

type P = ReturnType<typeof usePlayer>;

export function PlayButtons({ p, total }: { p: P; total: number }) {
  return (
    <div className="controls">
      <button className="btn" onClick={p.replay} disabled={total < 2} title="Replay (R)">
        <IconReplay /> Replay
      </button>
      <button className="btn" onClick={p.toggle} disabled={total < 2} title="Play / pause (Space)">
        {p.playing ? <IconPause /> : <IconPlay />} {p.playing ? 'Pause' : 'Play'}
      </button>
    </div>
  );
}

export function Timeline({ p, total, label }: { p: P; total: number; label?: string }) {
  return (
    <div className="timeline card">
      <div className="timeline-head">
        <span className="eyebrow">{label ?? 'Timeline'}</span>
        <div className="speed">
          Speed
          <select className="select" value={p.speed} onChange={(e) => p.setSpeed(Number(e.target.value))} aria-label="Playback speed">
            {SPEEDS.map((s) => (
              <option key={s} value={s}>
                {s}×
              </option>
            ))}
          </select>
          <span>
            Step {total ? p.idx + 1 : 0} of {total}
          </span>
        </div>
      </div>
      <div className="scrub">
        <button className="btn icon" onClick={p.prev} disabled={p.idx === 0} aria-label="Previous step">
          <IconPrev />
        </button>
        <input type="range" min={0} max={Math.max(0, total - 1)} value={p.idx} onChange={(e) => p.seek(Number(e.target.value))} aria-label="Step" />
        <button className="btn icon" onClick={p.next} disabled={p.idx >= total - 1} aria-label="Next step">
          <IconNext />
        </button>
      </div>
    </div>
  );
}

export function KeyHint() {
  return (
    <div className="hint">
      <span className="kbd">←</span>
      <span className="kbd">→</span> step · <span className="kbd">Space</span> play/pause · <span className="kbd">R</span> replay
    </div>
  );
}
