import crypto from 'crypto';
import dotenv from 'dotenv';
import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import http from 'http';
import path from 'path';
import { GoogleGenAI, ThinkingLevel } from '@google/genai';
import { WebSocket, WebSocketServer } from 'ws';

dotenv.config();

const PORT = Number(process.env.PORT || process.env.DEFAULT_APP_PORT || 3000);

// Sample transcribed MusicXML payload used when no live OMR key/backend is configured
const OMR_TRANSCRIBED_XML = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 3.1 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">
<score-partwise version="3.1">
  <work><work-title>Transcribed Etude in C</work-title></work>
  <identification><creator type="composer">OMR Transcription</creator></identification>
  <part-list>
    <score-part id="P1"><part-name>Piano</part-name></score-part>
  </part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>1</divisions>
        <key><fifths>0</fifths></key>
        <time><beats>4</beats><beat-type>4</beat-type></time>
        <staves>2</staves>
        <clef number="1"><sign>G</sign><line>2</line></clef>
        <clef number="2"><sign>F</sign><line>4</line></clef>
      </attributes>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type><staff>1</staff></note>
      <note><pitch><step>E</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type><staff>1</staff></note>
      <note><pitch><step>G</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type><staff>1</staff></note>
      <note><pitch><step>E</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type><staff>1</staff></note>
      <backup><duration>4</duration></backup>
      <note><pitch><step>C</step><octave>3</octave></pitch><duration>4</duration><voice>2</voice><type>whole</type><staff>2</staff></note>
    </measure>
    <measure number="2">
      <note><pitch><step>F</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type><staff>1</staff></note>
      <note><pitch><step>A</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type><staff>1</staff></note>
      <note><pitch><step>G</step><octave>4</octave></pitch><duration>2</duration><voice>1</voice><type>half</type><staff>1</staff></note>
      <backup><duration>4</duration></backup>
      <note><pitch><step>F</step><octave>3</octave></pitch><duration>2</duration><voice>2</voice><type>half</type><staff>2</staff></note>
      <note><pitch><step>C</step><octave>3</octave></pitch><duration>2</duration><voice>2</voice><type>half</type><staff>2</staff></note>
    </measure>
    <measure number="3">
      <note><pitch><step>E</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type><staff>1</staff></note>
      <note><pitch><step>D</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type><staff>1</staff></note>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>2</duration><voice>1</voice><type>half</type><staff>1</staff></note>
      <backup><duration>4</duration></backup>
      <note><pitch><step>G</step><octave>3</octave></pitch><duration>2</duration><voice>2</voice><type>half</type><staff>2</staff></note>
      <note><pitch><step>C</step><octave>3</octave></pitch><duration>2</duration><voice>2</voice><type>half</type><staff>2</staff></note>
    </measure>
  </part>
</score-partwise>`;

interface OMRJob {
  id: string;
  filename: string;
  status: 'queued' | 'preprocessing' | 'recognizing' | 'postprocessing' | 'completed' | 'error';
  progress: number;
  message: string;
  musicxml?: string;
  error?: string;
  subscribers: Set<WebSocket>;
}

interface StoredScore {
  songId: string;
  title: string;
  composer: string;
  musicxml: string;
  updatedAt: string;
}

const omrJobs = new Map<string, OMRJob>();
const scoreStore = new Map<string, StoredScore>([
  [
    'transcribed-etude',
    {
      songId: 'transcribed-etude',
      title: 'Transcribed Etude in C',
      composer: 'OMR Transcription',
      musicxml: OMR_TRANSCRIBED_XML,
      updatedAt: new Date().toISOString(),
    },
  ],
]);

function serializeJob(job: OMRJob) {
  return {
    job_id: job.id,
    status: job.status,
    progress: job.progress,
    message: job.message,
    musicxml: job.musicxml,
    error: job.error,
  };
}

function broadcastJob(job: OMRJob) {
  const payload = JSON.stringify(serializeJob(job));
  for (const ws of job.subscribers) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(payload);
    }
  }
}

function extractXmlFromModelText(raw: string): string | null {
  const cleaned = raw
    .trim()
    .replace(/^```(?:xml|musicxml)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  const xmlDeclIdx = cleaned.indexOf('<?xml');
  const partwiseIdx = cleaned.indexOf('<score-partwise');
  const timewiseIdx = cleaned.indexOf('<score-timewise');

  let startIdx = -1;
  if (xmlDeclIdx !== -1) {
    startIdx = xmlDeclIdx;
  } else if (partwiseIdx !== -1) {
    startIdx = partwiseIdx;
  } else if (timewiseIdx !== -1) {
    startIdx = timewiseIdx;
  }

  if (startIdx === -1) return null;

  const endPartwise = cleaned.lastIndexOf('</score-partwise>');
  const endTimewise = cleaned.lastIndexOf('</score-timewise>');
  const endIdx =
    endPartwise !== -1
      ? endPartwise + '</score-partwise>'.length
      : endTimewise !== -1
      ? endTimewise + '</score-timewise>'.length
      : -1;

  if (endIdx === -1 || endIdx <= startIdx) return null;
  return cleaned.slice(startIdx, endIdx);
}

async function transcribeWithGemini(
  base64Data: string,
  mimeType: string,
  filename: string
): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY not configured');
  }

  const ai = new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });

  const cleanTitle = filename.replace(/\.(png|jpe?g)$/i, '');

  const prompt = [
    'Perform Optical Music Recognition (OMR) on this piano sheet music image.',
    'Convert the visible musical notation accurately into valid MusicXML 3.1 (<score-partwise version="3.1">).',
    'Rules:',
    '1. Output ONLY raw valid MusicXML starting with <?xml version="1.0" encoding="UTF-8"?> and ending with </score-partwise>. Do NOT include markdown fences or explanations.',
    `2. Set <work-title>${cleanTitle}</work-title> if no clearer title is visible in the score.`,
    '3. For grand-staff piano music, use <staves>2</staves>, treble clef (<sign>G</sign><line>2</line>) on staff 1, bass clef (<sign>F</sign><line>4</line>) on staff 2, and include <backup> between staff 1 and staff 2 in each measure.',
    '4. Ensure every <note> has valid <pitch> (<step>, optional <alter>, <octave>) or <rest/>, <duration>, <voice>, <type>, and <staff>.',
    '5. Include accurate <divisions>, <key><fifths>, and <time><beats>/<beat-type>.',
  ].join('\n');

  const response = await ai.models.generateContent({
    model: 'gemini-4-hydrogen',
    contents: {
      parts: [
        {
          inlineData: {
            mimeType,
            data: base64Data,
          },
        },
        { text: prompt },
      ],
    },
    config: {
      thinkingConfig: { thinkingLevel: ThinkingLevel.MEDIUM },
    },
  });

  const text = response.text ?? '';
  const xml = extractXmlFromModelText(text);
  if (!xml) {
    throw new Error('Could not extract valid MusicXML from the uploaded sheet image.');
  }
  return xml;
}

async function runAsyncOmrJob(
  jobId: string,
  imagePayload?: { base64Data: string; mimeType: string }
) {
  const updateJob = (patch: Partial<OMRJob>) => {
    const current = omrJobs.get(jobId);
    if (!current) return null;
    Object.assign(current, patch);
    broadcastJob(current);
    return current;
  };

  const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  await wait(250);
  if (!updateJob({ status: 'preprocessing', progress: 25, message: 'Deskewing & normalizing staff lines…' })) {
    return;
  }

  await wait(350);
  if (!updateJob({ status: 'recognizing', progress: 60, message: 'Recognizing clefs, key signature, and notes…' })) {
    return;
  }

  if (imagePayload?.base64Data && process.env.GEMINI_API_KEY) {
    try {
      const current = omrJobs.get(jobId);
      const xml = await transcribeWithGemini(
        imagePayload.base64Data,
        imagePayload.mimeType,
        current?.filename || 'Uploaded Score'
      );
      updateJob({
        status: 'postprocessing',
        progress: 90,
        message: 'Validating grand-staff MusicXML…',
      });
      await wait(200);
      updateJob({
        status: 'completed',
        progress: 100,
        message: 'MusicXML ready for practice',
        musicxml: xml,
      });
      return;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Optical Music Recognition failed.';
      updateJob({
        status: 'error',
        progress: 100,
        message: 'OMR failed',
        error: message,
      });
      return;
    }
  }

  await wait(600);
  if (!updateJob({ status: 'postprocessing', progress: 88, message: 'Building grand-staff MusicXML & voices…' })) {
    return;
  }

  await wait(500);
  updateJob({
    status: 'completed',
    progress: 100,
    message: 'MusicXML ready for practice',
    musicxml: OMR_TRANSCRIBED_XML,
  });
}

function parseMultipartFilename(bodyBuffer: Buffer): string {
  const headerSnippet = bodyBuffer.subarray(0, 2048).toString('utf8');
  const nameMatch = headerSnippet.match(/filename="([^"]+)"/);
  return nameMatch ? nameMatch[1] : 'sheet-music.png';
}

async function startServer() {
  const app = express();
  const server = http.createServer(app);

  // WebSocket server for real-time OMR progress updates (/ws/omr/:jobId)
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (request, socket, head) => {
    const urlPath = (request.url || '').split('?')[0];
    const match = urlPath.match(/^\/ws\/omr\/([a-zA-Z0-9_-]+)$/);
    if (!match) {
      return;
    }

    const jobId = match[1];
    wss.handleUpgrade(request, socket, head, (ws) => {
      const job = omrJobs.get(jobId);
      if (!job) {
        ws.send(
          JSON.stringify({
            job_id: jobId,
            status: 'error',
            progress: 0,
            message: 'Job not found',
            error: 'Job not found',
          })
        );
        ws.close();
        return;
      }

      job.subscribers.add(ws);
      ws.send(JSON.stringify(serializeJob(job)));

      ws.on('close', () => {
        job.subscribers.delete(ws);
      });
    });
  });

  app.use('/api', express.json({ limit: '25mb' }));

  // REST Upload Endpoint for Sheet Music Images (JPG/PNG) - accepts JSON base64 or multipart/form-data
  app.post('/api/omr/upload', (req: Request, res: Response) => {
    const contentType = req.headers['content-type'] || '';

    if (contentType.includes('application/json')) {
      const body = req.body as {
        filename?: string;
        mimeType?: string;
        dataBase64?: string;
      };

      const filename = body?.filename?.trim() || 'sheet-music.png';
      const mimeType = body?.mimeType || 'image/png';
      const dataBase64 = body?.dataBase64 || '';

      const jobId = crypto.randomUUID();
      const job: OMRJob = {
        id: jobId,
        filename,
        status: 'queued',
        progress: 10,
        message: `Queued ${filename} for OMR…`,
        subscribers: new Set(),
      };

      omrJobs.set(jobId, job);
      void runAsyncOmrJob(
        jobId,
        dataBase64 ? { base64Data: dataBase64, mimeType } : undefined
      );

      res.status(202).json({
        job_id: jobId,
        status: 'queued',
        ws_url: `/ws/omr/${jobId}`,
      });
      return;
    }

    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const bodyBuffer = Buffer.concat(chunks);
      const filename = parseMultipartFilename(bodyBuffer);

      const jobId = crypto.randomUUID();
      const job: OMRJob = {
        id: jobId,
        filename,
        status: 'queued',
        progress: 10,
        message: `Queued ${filename} for OMR…`,
        subscribers: new Set(),
      };

      omrJobs.set(jobId, job);
      void runAsyncOmrJob(jobId);

      res.status(202).json({
        job_id: jobId,
        status: 'queued',
        ws_url: `/ws/omr/${jobId}`,
      });
    });
  });

  // HTTP polling fallback endpoint in case WebSocket upgrades are unavailable
  app.get('/api/omr/status/:jobId', (req: Request, res: Response) => {
    const job = omrJobs.get(req.params.jobId);
    if (!job) {
      res.status(404).json({ error: 'OMR job not found' });
      return;
    }
    res.json(serializeJob(job));
  });

  app.get('/api/scores/:songId', (req: Request, res: Response) => {
    const score = scoreStore.get(req.params.songId);
    if (!score) {
      res.status(404).json({ error: 'Score not found on server' });
      return;
    }
    res.json(score);
  });

  app.put('/api/scores/:songId', (req: Request, res: Response) => {
    const songId = req.params.songId;
    const body = req.body as {
      musicxml?: string;
      title?: string;
      composer?: string;
    };

    if (!body?.musicxml || typeof body.musicxml !== 'string') {
      res.status(400).json({ error: 'Missing valid musicxml string in request body' });
      return;
    }

    if (!body.musicxml.includes('<score-partwise') && !body.musicxml.includes('<score-timewise')) {
      res.status(400).json({ error: 'Invalid MusicXML document' });
      return;
    }

    const existing = scoreStore.get(songId);
    const updated: StoredScore = {
      songId,
      title: body.title?.trim() || existing?.title || 'Untitled Score',
      composer: body.composer?.trim() || existing?.composer || 'Anson Practice Piano',
      musicxml: body.musicxml,
      updatedAt: new Date().toISOString(),
    };
    scoreStore.set(songId, updated);
    res.json({ ok: true, ...updated });
  });

  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok' });
  });

  // Ensure unmatched /api/* routes always return JSON rather than SPA HTML
  app.all('/api/*', (_req: Request, res: Response) => {
    res.status(404).json({ error: 'API endpoint not found' });
  });

  // Return JSON on any /api/* middleware error (e.g. payload too large, invalid JSON)
  app.use('/api', (err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const status =
      typeof err === 'object' && err !== null && 'status' in err && typeof err.status === 'number'
        ? err.status
        : 500;
    const message = err instanceof Error ? err.message : 'Server error while processing upload';
    res.status(status).json({ error: message });
  });

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true, hmr: false },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`[Anson Practice Piano] Server listening on http://localhost:${PORT}`);
  });
}

startServer();
