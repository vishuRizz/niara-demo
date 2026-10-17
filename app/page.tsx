'use client';

import { useEffect, useRef, useState } from 'react';
import { LANGS } from '@/lib/config';
import { VoiceAgent, type VoiceState } from '@/lib/voiceAgent';
import styles from './page.module.css';

const STATUS: Record<VoiceState, string> = {
  idle: 'Tap to start talking',
  connecting: 'Connecting…',
  listening: 'Listening',
  thinking: 'Thinking…',
  speaking: '',
};

interface Turn {
  id: number;
  role: 'user' | 'assistant';
  text: string;
}

// Multilingual: Deepgram listens in any language and the agent answers in kind.
const LANG = LANGS[0];

export default function Home() {
  const [state, setState] = useState<VoiceState>('idle');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);
  const [showLog, setShowLog] = useState(false);
  const agent = useRef<VoiceAgent | null>(null);
  const orb = useRef<HTMLDivElement>(null);
  const idRef = useRef(0);
  const logEnd = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const a = new VoiceAgent({
      onState: setState,
      onText: (role, text) => setTurns((t) => [...t, { id: ++idRef.current, role, text }]),
      onError: setError,
    });
    agent.current = a;
    let raf = 0;
    const tick = () => {
      orb.current?.style.setProperty('--lvl', a.getLevel().toFixed(3));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      a.stop();
    };
  }, []);

  useEffect(() => {
    logEnd.current?.scrollIntoView({ behavior: 'smooth' });
  }, [turns, showLog]);

  const active = state !== 'idle';
  const last = turns[turns.length - 1];

  const start = () => {
    if (active) return;
    setError(null);
    setMuted(false);
    void agent.current?.start(LANG);
  };
  const end = () => {
    agent.current?.stop();
    setMuted(false);
  };
  const toggleMute = () => {
    if (agent.current) agent.current.muted = !muted;
    setMuted(!muted);
  };

  return (
    <main className={styles.page} data-state={state}>
      <div className={styles.glow} aria-hidden />

      <header className={styles.top}>
        <span className={styles.brand}>Niara</span>
        {turns.length > 0 && (
          <button className={styles.textBtn} onClick={() => setShowLog((v) => !v)}>
            {showLog ? 'Hide transcript' : 'Transcript'}
          </button>
        )}
      </header>

      <section className={styles.stage}>
        <div
          ref={orb}
          className={styles.orbWrap}
          onClick={active ? undefined : start}
          role={active ? undefined : 'button'}
          aria-label={active ? undefined : 'Start voice chat'}
        >
          <div className={styles.orb}>
            <i className={styles.blob1} />
            <i className={styles.blob2} />
            <i className={styles.blob3} />
            <i className={styles.shine} />
          </div>
        </div>

        <p className={styles.status}>{error ? '' : STATUS[state]}</p>

        <p key={last?.id} className={`${styles.caption} ${last?.role === 'user' ? styles.captionUser : ''}`}>
          {error ?? (active ? last?.text : '')}
        </p>
      </section>

      {showLog && (
        <aside className={styles.log}>
          {turns.map((t) => (
            <div key={t.id} className={t.role === 'user' ? styles.user : styles.agent}>
              {t.text}
            </div>
          ))}
          <div ref={logEnd} />
        </aside>
      )}

      <footer className={styles.controls}>
        {active ? (
          <>
            <button
              className={`${styles.round} ${muted ? styles.roundOn : ''}`}
              onClick={toggleMute}
              aria-label={muted ? 'Unmute microphone' : 'Mute microphone'}
            >
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                <rect x="9" y="3.5" width="6" height="11" rx="3" />
                <path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v2.5M9 20.5h6" />
                {muted && <path d="M4 4l16 16" />}
              </svg>
            </button>
            <button className={`${styles.round} ${styles.end}`} onClick={end} aria-label="End conversation">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </>
        ) : (
          <button className={styles.start} onClick={start}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              <rect x="9" y="3.5" width="6" height="11" rx="3" />
              <path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v2.5M9 20.5h6" />
            </svg>
            Start talking
          </button>
        )}
      </footer>
    </main>
  );
}
