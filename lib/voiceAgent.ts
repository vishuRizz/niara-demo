import { AGENT_URL, INPUT_RATE, OUTPUT_RATE, buildSettings, type Lang } from './config';

export type VoiceState = 'idle' | 'connecting' | 'listening' | 'thinking' | 'speaking';

export interface Callbacks {
  onState: (s: VoiceState) => void;
  onText: (role: 'user' | 'assistant', text: string) => void;
  onError: (msg: string) => void;
}

const WORKLET = `
class Tap extends AudioWorkletProcessor {
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) this.port.postMessage(ch.slice(0));
    return true;
  }
}
registerProcessor('tap', Tap);`;

function resample(input: Float32Array, from: number, to: number): Float32Array {
  if (from === to) return input;
  const ratio = from / to;
  const out = new Float32Array(Math.floor(input.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const pos = i * ratio;
    const idx = Math.floor(pos);
    const a = input[idx] ?? 0;
    const b = input[idx + 1] ?? a;
    out[i] = a + (b - a) * (pos - idx);
  }
  return out;
}

function toPcm16(f: Float32Array): ArrayBuffer {
  const out = new Int16Array(f.length);
  for (let i = 0; i < f.length; i++) {
    const s = Math.max(-1, Math.min(1, f[i]));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out.buffer;
}

/** Browser Voice Agent client: mic -> Deepgram WebSocket -> scheduled PCM playback. */
export class VoiceAgent {
  muted = false;
  private ws: WebSocket | null = null;
  private mic: AudioContext | null = null;
  private out: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private keepAlive: ReturnType<typeof setInterval> | null = null;
  private ready = false;
  private nextTime = 0;
  private sources = new Set<AudioBufferSourceNode>();
  private leftover: Uint8Array | null = null;
  private analyser: AnalyserNode | null = null;
  private analyserData: Uint8Array<ArrayBuffer> | null = null;
  private micLevel = 0;
  private smoothed = 0;

  constructor(private cb: Callbacks) {}

  async start(lang: Lang) {
    this.cb.onState('connecting');
    try {
      const tokenRes = await fetch('/api/token', { method: 'POST' });
      const tokenBody = await tokenRes.json();
      if (!tokenRes.ok) throw new Error(tokenBody.error ?? 'Could not get a token');

      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 },
      });
      this.out = new AudioContext({ sampleRate: OUTPUT_RATE });
      await this.out.resume();
      this.analyser = this.out.createAnalyser();
      this.analyser.fftSize = 512;
      this.analyser.connect(this.out.destination);
      this.analyserData = new Uint8Array(this.analyser.fftSize);

      this.mic = new AudioContext();
      const url = URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' }));
      await this.mic.audioWorklet.addModule(url);
      URL.revokeObjectURL(url);
      const node = new AudioWorkletNode(this.mic, 'tap');
      this.mic.createMediaStreamSource(this.stream).connect(node);
      const micRate = this.mic.sampleRate;
      node.port.onmessage = (e: MessageEvent<Float32Array>) => {
        let sum = 0;
        for (let i = 0; i < e.data.length; i++) sum += e.data[i] * e.data[i];
        this.micLevel = this.muted ? 0 : Math.sqrt(sum / e.data.length);
        if (!this.ready || this.muted || this.ws?.readyState !== WebSocket.OPEN) return;
        this.ws.send(toPcm16(resample(e.data, micRate, INPUT_RATE)));
      };

      const ws = new WebSocket(AGENT_URL, [tokenBody.scheme, tokenBody.credential]);
      ws.binaryType = 'arraybuffer';
      this.ws = ws;
      ws.onmessage = (m) => this.onMessage(m.data, lang);
      ws.onerror = () => this.fail('Connection to Deepgram failed.');
      ws.onclose = () => this.stop();
    } catch (e) {
      this.fail(e instanceof Error ? e.message : 'Could not start voice.');
    }
  }

  private onMessage(data: string | ArrayBuffer, lang: Lang) {
    if (typeof data !== 'string') {
      if (this.ready) this.play(data);
      return;
    }
    const m = JSON.parse(data);
    switch (m.type) {
      case 'Welcome':
        this.ws?.send(JSON.stringify(buildSettings(lang)));
        break;
      case 'SettingsApplied':
        this.ready = true;
        this.keepAlive = setInterval(() => this.ws?.send(JSON.stringify({ type: 'KeepAlive' })), 8000);
        this.cb.onState('listening');
        break;
      case 'UserStartedSpeaking':
        this.interrupt();
        this.cb.onState('listening');
        break;
      case 'AgentThinking':
        this.cb.onState('thinking');
        break;
      case 'AgentStartedSpeaking':
        this.cb.onState('speaking');
        break;
      case 'AgentAudioDone':
        this.cb.onState('listening');
        break;
      case 'ConversationText':
        this.cb.onText(m.role, m.content);
        break;
      case 'Error':
        this.fail(m.description ?? m.code ?? 'Agent error');
        break;
    }
  }

  private play(frame: ArrayBuffer) {
    const ctx = this.out;
    if (!ctx) return;
    let bytes = new Uint8Array(frame);
    if (this.leftover) {
      const j = new Uint8Array(this.leftover.length + bytes.length);
      j.set(this.leftover);
      j.set(bytes, this.leftover.length);
      bytes = j;
      this.leftover = null;
    }
    if (bytes.length % 2) {
      this.leftover = bytes.slice(-1);
      bytes = bytes.slice(0, -1);
    }
    if (!bytes.length) return;
    const pcm = new Int16Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length));
    const buf = ctx.createBuffer(1, pcm.length, OUTPUT_RATE);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < pcm.length; i++) ch[i] = pcm[i] / 0x8000;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(this.analyser ?? ctx.destination);
    const at = Math.max(ctx.currentTime + 0.02, this.nextTime);
    src.start(at);
    this.nextTime = at + buf.duration;
    this.sources.add(src);
    src.onended = () => this.sources.delete(src);
  }

  /** Smoothed 0..1 loudness of whoever is talking right now — drives the orb. */
  getLevel(): number {
    let out = 0;
    if (this.analyser && this.analyserData) {
      this.analyser.getByteTimeDomainData(this.analyserData);
      let sum = 0;
      for (const v of this.analyserData) sum += ((v - 128) / 128) ** 2;
      out = Math.sqrt(sum / this.analyserData.length);
    }
    const raw = Math.min(1, Math.max(out, this.micLevel) * 4);
    this.smoothed += (raw - this.smoothed) * (raw > this.smoothed ? 0.5 : 0.12);
    return this.smoothed;
  }

  /** Barge-in: drop whatever the agent still had queued. */
  private interrupt() {
    this.sources.forEach((s) => {
      try {
        s.stop();
      } catch {}
    });
    this.sources.clear();
    this.leftover = null;
    this.nextTime = 0;
  }

  private fail(msg: string) {
    this.cb.onError(msg);
    this.stop();
  }

  stop() {
    if (this.keepAlive) clearInterval(this.keepAlive);
    this.keepAlive = null;
    this.ready = false;
    this.interrupt();
    const ws = this.ws;
    this.ws = null;
    if (ws) {
      ws.onclose = null;
      ws.close();
    }
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    void this.mic?.close();
    void this.out?.close();
    this.mic = this.out = this.analyser = null;
    this.micLevel = 0;
    this.cb.onState('idle');
  }
}
