export const AGENT_URL = 'wss://agent.deepgram.com/v1/agent/converse';
export const INPUT_RATE = 16000;
export const OUTPUT_RATE = 24000;

export interface Lang {
  id: string;
  label: string;
  name: string;
  voice: string;
  /** Multilingual ElevenLabs voice instead of an Aura-2 voice (needed for Hindi etc.). */
  multilingual?: boolean;
  greeting: string;
}

/** Listening is always multilingual (nova-3 `multi`); Aura-2 voices cover these languages for speaking. */
export const LANGS: Lang[] = [
  { id: 'auto', label: 'Auto', name: 'English', voice: '', multilingual: true, greeting: "Hi, I'm Niara. What's on your mind today?" },
  { id: 'hi', label: 'हिन्दी', name: 'Hindi', voice: '', multilingual: true, greeting: 'नमस्ते, मैं नियारा हूँ। आज मैं आपकी क्या मदद कर सकती हूँ?' },
  { id: 'en', label: 'English', name: 'English', voice: 'aura-2-thalia-en', greeting: "Hi, I'm Niara. What's on your mind today?" },
  { id: 'es', label: 'Español', name: 'Spanish', voice: 'aura-2-celeste-es', greeting: 'Hola, soy Niara. ¿En qué puedo ayudarte hoy?' },
  { id: 'fr', label: 'Français', name: 'French', voice: 'aura-2-agathe-fr', greeting: "Bonjour, je suis Niara. Comment puis-je t'aider ?" },
  { id: 'de', label: 'Deutsch', name: 'German', voice: 'aura-2-viktoria-de', greeting: 'Hallo, ich bin Niara. Wie kann ich dir helfen?' },
  { id: 'it', label: 'Italiano', name: 'Italian', voice: 'aura-2-livia-it', greeting: 'Ciao, sono Niara. Come posso aiutarti?' },
  { id: 'nl', label: 'Nederlands', name: 'Dutch', voice: 'aura-2-beatrix-nl', greeting: 'Hoi, ik ben Niara. Waarmee kan ik je helpen?' },
  { id: 'ja', label: '日本語', name: 'Japanese', voice: 'aura-2-izanami-ja', greeting: 'こんにちは、Niaraです。今日はどうしましたか？' },
];

export function systemPrompt(lang: Lang, hasKnowledge: boolean): string {
  return [
    "You are Niara, a warm, gentle voice companion in a period-tracking and women's wellness app.",
    'You answer general questions about periods, cycles, PMS, fertility, mood, sleep, nutrition and self-care.',
    'When you do reply in Hindi, write it in Devanagari script (other languages in their native script) so the text-to-speech pronounces it correctly.',
    'This is a spoken conversation: reply in one to three short sentences, plain words, no lists, no markdown, no emojis.',
    lang.id === 'auto'
      ? "Language: reply in the language of the user's LATEST message only. English is the default: if the latest message is in English (even with an Indian or other accent), reply in English. Reply in Hindi only if that latest message is actually Hindi (or Hinglish asking for Hindi). Never switch language because of earlier turns or your own greeting."
      : `Reply in ${lang.name}.`,
    'You are not a doctor. Never diagnose. For severe pain, very heavy bleeding, pregnancy concerns or anything alarming, kindly suggest seeing a healthcare professional.',
    hasKnowledge
      ? "Use the search_knowledge function for anything about the user's own data or medical facts, and ground your answer in what it returns."
      : 'If you do not know something, say so rather than guessing.',
  ].join('\n');
}

/**
 * Aura-2 only speaks a handful of languages, and an English voice reading
 * Hindi sounds wrong. Multilingual mode uses Deepgram-hosted ElevenLabs.
 */
function speakProvider(lang: Lang) {
  return lang.multilingual
    ? { type: 'eleven_labs', model_id: 'eleven_flash_v2_5', voice_id: MULTILINGUAL_VOICE_ID }
    : { type: 'deepgram', model: lang.voice };
}

/** ElevenLabs "Rachel" — a stock voice that speaks every language flash_v2_5 supports. */
const MULTILINGUAL_VOICE_ID = '21m00Tcm4TlvDq8ikWAM';

export function buildSettings(lang: Lang) {
  return {
    type: 'Settings',
    audio: {
      input: { encoding: 'linear16', sample_rate: INPUT_RATE },
      output: { encoding: 'linear16', sample_rate: OUTPUT_RATE, container: 'none' },
    },
    agent: {
      listen: {
        provider: { type: 'deepgram', model: 'nova-3', language: 'multi', smart_format: true },
      },
      think: {
        provider: { type: 'open_ai', model: 'gpt-4o-mini', temperature: 0.6 },
        prompt: systemPrompt(lang, false),
      },
      speak: { provider: speakProvider(lang) },
      greeting: lang.greeting,
    },
  };
}
