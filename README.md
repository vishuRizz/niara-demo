# Niara voice demo

Browser test page for the Deepgram voice agent (same settings as the mobile Voice tab).

```bash
cp .env.example .env.local   # set DEEPGRAM_API_KEY
npm run dev                  # http://localhost:3000
```

`/api/token` mints a short-lived Deepgram token; in development it falls back to the raw key if the key can't mint tokens.
