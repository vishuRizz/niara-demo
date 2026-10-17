import { NextResponse } from 'next/server';

/** Mints a short-lived Deepgram token so the real key never reaches the browser. */
export async function POST() {
  const key = process.env.DEEPGRAM_API_KEY;
  if (!key) {
    return NextResponse.json({ error: 'DEEPGRAM_API_KEY is not set in demo/.env.local' }, { status: 503 });
  }
  const res = await fetch('https://api.deepgram.com/v1/auth/grant', {
    method: 'POST',
    headers: { Authorization: `Token ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ttl_seconds: 120 }),
  });
  if (res.ok) {
    const { access_token } = (await res.json()) as { access_token: string };
    return NextResponse.json({ scheme: 'bearer', credential: access_token });
  }
  // Some keys can't mint tokens (403). Local demo only: hand back the key itself.
  if (process.env.NODE_ENV === 'development') {
    return NextResponse.json({ scheme: 'token', credential: key });
  }
  return NextResponse.json({ error: `Deepgram refused the token request (${res.status})` }, { status: 502 });
}
