export interface AuditFrameInput {
  mimeType: string;
  base64: string;
}

export interface AuditProxyPayload {
  provider?: 'gemini' | 'openai';
  prompt: string;
  frames: AuditFrameInput[];
  clientApiKey?: string;
}

export interface AuditProxyResult {
  status: number;
  body: Record<string, unknown>;
}

const GEMINI_MODEL_FALLBACKS = [
  'gemini-3.8-flash',
  'gemini-3-flash-preview',
  'gemini-3.1-flash-lite',
];

const RETRYABLE_STATUSES = new Set([404, 429, 500, 502, 503, 504]);

function getProcessEnv(): Record<string, string | undefined> {
  const g = globalThis as { process?: { env?: Record<string, string | undefined> } };
  return g.process?.env ?? {};
}

export async function runAuditProxy(
  payload: AuditProxyPayload,
  env: Record<string, string | undefined> = getProcessEnv(),
): Promise<AuditProxyResult> {
  const provider = payload.provider === 'openai' ? 'openai' : 'gemini';
  const prompt = typeof payload.prompt === 'string' ? payload.prompt.trim() : '';
  const frames = Array.isArray(payload.frames) ? payload.frames.slice(0, 14) : [];

  if (!prompt || frames.length === 0) {
    return {
      status: 400,
      body: { error: 'Prompt dan minimal 1 frame gambar wajib dikirim.' },
    };
  }

  if (provider === 'openai') {
    const apiKey = (payload.clientApiKey || env.OPENAI_API_KEY || '').trim();
    if (!apiKey) {
      return {
        status: 401,
        body: { error: 'OPENAI_API_KEY belum tersedia di server maupun input pengguna.' },
      };
    }

    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        temperature: 0.2,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              ...frames.map((f) => ({
                type: 'image_url',
                image_url: {
                  url: `data:${f.mimeType || 'image/jpeg'};base64,${f.base64}`,
                  detail: 'low',
                },
              })),
            ],
          },
        ],
      }),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      return {
        status: resp.status,
        body: { error: `OpenAI API error (${resp.status}): ${errText.slice(0, 220)}` },
      };
    }

    const json = (await resp.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const rawText = json.choices?.[0]?.message?.content ?? '';
    return {
      status: 200,
      body: { ok: true, modelUsed: 'gpt-4o-mini', rawText },
    };
  }

  const apiKey = (payload.clientApiKey || env.GEMINI_API_KEY || '').trim();
  if (!apiKey) {
    return {
      status: 401,
      body: {
        error:
          'GEMINI_API_KEY belum dikonfigurasi di server (.env.local / Vercel Env) dan tidak ada key manual.',
      },
    };
  }

  const parts = [
    { text: prompt },
    ...frames.map((f) => ({
      inlineData: {
        mimeType: f.mimeType || 'image/jpeg',
        data: f.base64,
      },
    })),
  ];

  let lastStatus = 502;
  let lastError = 'Gagal menghubungi layanan Gemini.';

  for (const model of GEMINI_MODEL_FALLBACKS) {
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(
      apiKey,
    )}`;

    try {
      const resp = await fetch(endpoint, {
        method: 'POST',
        signal: AbortSignal.timeout(45000),
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts }],
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 8192,
            responseMimeType: 'application/json',
          },
        }),
      });

      if (resp.ok) {
        const json = (await resp.json()) as {
          candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
        };
        const rawText = json.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
        return {
          status: 200,
          body: { ok: true, modelUsed: model, rawText },
        };
      }

      const errText = await resp.text();
      lastStatus = resp.status;
      lastError = `Gemini (${model}) error ${resp.status}: ${errText.slice(0, 200)}`;
      if (!RETRYABLE_STATUSES.has(resp.status)) {
        break;
      }
    } catch (err) {
      lastStatus = 502;
      lastError = err instanceof Error ? err.message : 'Network error saat menghubungi Gemini.';
    }
  }

  return {
    status: lastStatus,
    body: { error: lastError },
  };
}

export interface HttpLikeReq {
  method?: string;
  body?: unknown;
  [Symbol.asyncIterator](): AsyncIterator<Uint8Array | string>;
}

export interface HttpLikeRes {
  statusCode: number;
  setHeader(name: string, value: string): void;
  end(body?: string): void;
}

async function readJsonBody(req: HttpLikeReq): Promise<AuditProxyPayload> {
  if (req.body && typeof req.body === 'object') {
    return req.body as AuditProxyPayload;
  }
  const chunks: Uint8Array[] = [];
  const encoder = new TextEncoder();
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? encoder.encode(chunk) : chunk);
  }
  const totalLen = chunks.reduce((acc, c) => acc + c.byteLength, 0);
  const merged = new Uint8Array(totalLen);
  let offset = 0;
  for (const c of chunks) {
    merged.set(c, offset);
    offset += c.byteLength;
  }
  const text = new TextDecoder().decode(merged);
  return (text ? JSON.parse(text) : {}) as AuditProxyPayload;
}

export default async function handler(req: HttpLikeReq, res: HttpLikeRes): Promise<void> {
  if (req.method !== 'POST') {
    res.statusCode = 405;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'Method not allowed' }));
    return;
  }

  try {
    const payload = await readJsonBody(req);
    const result = await runAuditProxy(payload, getProcessEnv());
    res.statusCode = result.status;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(result.body));
  } catch (err) {
    res.statusCode = 400;
    res.setHeader('Content-Type', 'application/json');
    res.end(
      JSON.stringify({
        error: err instanceof Error ? err.message : 'Payload JSON tidak valid.',
      }),
    );
  }
}
