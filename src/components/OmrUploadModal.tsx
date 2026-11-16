import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, FileMusic, ImageUp, Loader2, X } from 'lucide-react';
import { usePracticeStore } from '../store/usePracticeStore';
import { OMRProgressMessage, ScorePiece } from '../types/music';

interface OmrUploadModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const FALLBACK_SAMPLE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 3.1 Partwise//EN" "http://www.musicxml.org/dtd/partwise.dtd">
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

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      const commaIdx = result.indexOf(',');
      resolve(commaIdx >= 0 ? result.slice(commaIdx + 1) : result);
    };
    reader.onerror = () => reject(new Error('Failed to read image file.'));
    reader.readAsDataURL(file);
  });
}

async function parseJsonResponseSafely<T>(res: Response): Promise<{ ok: true; data: T } | { ok: false; isHtml: boolean; message: string }> {
  const contentType = res.headers.get('content-type') || '';
  const rawText = await res.text();
  const trimmed = rawText.trimStart();

  if (
    contentType.includes('text/html') ||
    trimmed.startsWith('<!doctype') ||
    trimmed.startsWith('<!DOCTYPE') ||
    trimmed.startsWith('<html')
  ) {
    return {
      ok: false,
      isHtml: true,
      message:
        'The OMR image endpoint returned an HTML page instead of JSON (the backend server is not attached on this preview URL). Upload a .musicxml / .xml file directly, or load the sample transcribed etude below.',
    };
  }

  try {
    const parsed = JSON.parse(rawText) as T & { error?: string };
    if (!res.ok) {
      return {
        ok: false,
        isHtml: false,
        message: parsed?.error || `Upload failed (${res.status})`,
      };
    }
    return { ok: true, data: parsed };
  } catch {
    return {
      ok: false,
      isHtml: false,
      message: res.ok
        ? 'Server returned an unexpected non-JSON response.'
        : `Upload failed (${res.status})`,
    };
  }
}

export function OmrUploadModal({ isOpen, onClose }: OmrUploadModalProps) {
  const [title, setTitle] = useState('');
  const [jobProgress, setJobProgress] = useState<OMRProgressMessage | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [backendUnavailable, setBackendUnavailable] = useState(false);
  const [pendingFilename, setPendingFilename] = useState<string>('sheet-music.png');
  const [isProcessing, setIsProcessing] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const pollTimerRef = useRef<number | null>(null);
  const completedRef = useRef<boolean>(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const addCustomScore = usePracticeStore((s) => s.addCustomScore);

  const cleanupStreams = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    if (pollTimerRef.current !== null) {
      window.clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      cleanupStreams();
    };
  }, [cleanupStreams]);

  if (!isOpen) return null;

  const loadXmlIntoStudio = (xmlText: string, fileName: string) => {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xmlText, 'application/xml');
    if (doc.querySelector('parsererror')) {
      setErrorMsg('The MusicXML document contains invalid XML markup.');
      setIsProcessing(false);
      return;
    }

    const measureNodes = doc.querySelectorAll('measure');
    const titleNode = doc.querySelector('work-title')?.textContent?.trim();
    const composerNode = doc.querySelector('creator[type="composer"]')?.textContent?.trim();
    const beats = doc.querySelector('time > beats')?.textContent?.trim();
    const beatType = doc.querySelector('time > beat-type')?.textContent?.trim();

    const cleanName =
      title.trim() || titleNode || fileName.replace(/\.(musicxml|xml|png|jpe?g)$/i, '');

    const piece: ScorePiece = {
      id: `custom-${Date.now()}`,
      title: cleanName,
      composer: composerNode || 'Uploaded Score',
      level: 'Custom',
      timeSignature: beats && beatType ? `${beats}/${beatType}` : '4/4',
      measures: Math.max(1, measureNodes.length),
      bpm: 80,
      musicXml: xmlText,
    };

    cleanupStreams();
    addCustomScore(piece);
    setIsProcessing(false);
    setJobProgress(null);
    setBackendUnavailable(false);
    setTitle('');
    onClose();
  };

  const handleJobPayload = (payload: OMRProgressMessage, fileName: string) => {
    if (completedRef.current) return;
    setJobProgress(payload);

    if (payload.status === 'completed' && payload.musicxml) {
      completedRef.current = true;
      cleanupStreams();
      window.setTimeout(() => {
        loadXmlIntoStudio(payload.musicxml!, fileName);
      }, 450);
    } else if (payload.status === 'error') {
      completedRef.current = true;
      cleanupStreams();
      setErrorMsg(payload.error || 'Optical Music Recognition failed.');
      setIsProcessing(false);
    }
  };

  const startPollingFallback = (jobId: string, fileName: string) => {
    if (pollTimerRef.current !== null || completedRef.current) return;

    pollTimerRef.current = window.setInterval(async () => {
      if (completedRef.current) {
        cleanupStreams();
        return;
      }
      try {
        const res = await fetch(`/api/omr/status/${encodeURIComponent(jobId)}`);
        const parsed = await parseJsonResponseSafely<OMRProgressMessage>(res);
        if (!parsed.ok) {
          if (res.status === 404 || parsed.isHtml) {
            cleanupStreams();
            setErrorMsg(parsed.message);
            setIsProcessing(false);
          }
          return;
        }
        handleJobPayload(parsed.data, fileName);
      } catch {
        // Retry on next interval tick
      }
    }, 800);
  };

  const handleFileSelected = async (file: File | undefined) => {
    if (!file) return;
    cleanupStreams();
    completedRef.current = false;
    setErrorMsg(null);
    setBackendUnavailable(false);
    setJobProgress(null);
    setPendingFilename(file.name);

    const lower = file.name.toLowerCase();

    // Fast path: direct MusicXML / XML file (100% client-side)
    if (lower.endsWith('.xml') || lower.endsWith('.musicxml')) {
      try {
        const text = await file.text();
        if (!text.includes('<score-partwise') && !text.includes('<score-timewise')) {
          setErrorMsg('The selected XML file is not a valid MusicXML score.');
          return;
        }
        loadXmlIntoStudio(text, file.name);
      } catch {
        setErrorMsg('Failed to read the MusicXML file.');
      }
      return;
    }

    // OMR path: JPG / PNG image -> JSON upload + WebSocket progress stream with HTTP polling fallback
    if (!lower.endsWith('.png') && !lower.endsWith('.jpg') && !lower.endsWith('.jpeg')) {
      setErrorMsg('Please choose a JPG, PNG sheet music image, or a .musicxml / .xml file.');
      return;
    }

    setIsProcessing(true);
    setJobProgress({
      job_id: 'pending',
      status: 'queued',
      progress: 5,
      message: 'Uploading sheet music image…',
    });

    try {
      const dataBase64 = await readFileAsBase64(file);

      const res = await fetch('/api/omr/upload', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          filename: file.name,
          mimeType: file.type || (lower.endsWith('.png') ? 'image/png' : 'image/jpeg'),
          dataBase64,
        }),
      });

      const parsed = await parseJsonResponseSafely<{ job_id?: string }>(res);
      if (!parsed.ok) {
        setErrorMsg(parsed.message);
        setBackendUnavailable(parsed.isHtml);
        setJobProgress(null);
        setIsProcessing(false);
        return;
      }

      const jobId = parsed.data.job_id;
      if (!jobId) {
        setErrorMsg('Server did not return an OMR job ID.');
        setJobProgress(null);
        setIsProcessing(false);
        return;
      }

      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}/ws/omr/${jobId}`;

      try {
        const ws = new WebSocket(wsUrl);
        wsRef.current = ws;

        ws.onmessage = (msgEvent) => {
          try {
            const payload = JSON.parse(msgEvent.data as string) as OMRProgressMessage;
            handleJobPayload(payload, file.name);
          } catch {
            // Ignore malformed WebSocket frame
          }
        };

        ws.onerror = () => {
          startPollingFallback(jobId, file.name);
        };

        ws.onclose = () => {
          if (!completedRef.current) {
            startPollingFallback(jobId, file.name);
          }
        };
      } catch {
        startPollingFallback(jobId, file.name);
      }

      // Start backup poll after 1.8s in case WS connects silently without delivering frames
      window.setTimeout(() => {
        if (!completedRef.current && pollTimerRef.current === null) {
          startPollingFallback(jobId, file.name);
        }
      }, 1800);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to start OMR job.');
      setJobProgress(null);
      setIsProcessing(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="upload-modal-title"
    >
      <div className="w-full max-w-lg bg-white border border-slate-200 rounded-xl shadow-lg overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <h2 id="upload-modal-title" className="font-display text-lg font-semibold text-slate-900">
            Upload Sheet Music
          </h2>
          <button
            type="button"
            onClick={() => {
              completedRef.current = true;
              cleanupStreams();
              setIsProcessing(false);
              setErrorMsg(null);
              setBackendUnavailable(false);
              setJobProgress(null);
              onClose();
            }}
            aria-label="Close upload dialog"
            className="p-1.5 text-slate-500 hover:text-slate-900 rounded-lg hover:bg-slate-100 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-5">
          <div>
            <label htmlFor="piece-title-input" className="block text-xs font-semibold text-slate-700 mb-1.5">
              Piece Title (Optional)
            </label>
            <input
              id="piece-title-input"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g., Fur Elise — Page 1"
              disabled={isProcessing}
              className="w-full px-3.5 py-2 text-sm bg-white border border-slate-300 rounded-lg text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-600"
            />
          </div>

          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              if (!isProcessing) void handleFileSelected(e.dataTransfer.files[0]);
            }}
            className="border-2 border-dashed border-slate-300 hover:border-sky-500 bg-slate-50 rounded-xl p-7 text-center transition-colors"
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".png,.jpg,.jpeg,.xml,.musicxml"
              className="hidden"
              onChange={(e) => {
                const selected = e.target.files?.[0];
                e.target.value = '';
                void handleFileSelected(selected);
              }}
            />

            <div className="flex justify-center gap-3 text-slate-500 mb-3">
              <ImageUp className="w-6 h-6 text-sky-600" aria-hidden="true" />
              <FileMusic className="w-6 h-6 text-emerald-600" aria-hidden="true" />
            </div>

            <p className="text-sm font-semibold text-slate-900 mb-1">
              Drop a sheet music photo or MusicXML file
            </p>
            <p className="text-xs text-slate-500 mb-4">
              Supports JPG / PNG (via async OMR pipeline) or .musicxml / .xml
            </p>

            <button
              type="button"
              disabled={isProcessing}
              onClick={() => fileInputRef.current?.click()}
              className="px-4 py-2 text-sm font-semibold text-white bg-sky-600 hover:bg-sky-700 disabled:opacity-50 rounded-lg transition-colors"
            >
              Choose File
            </button>
          </div>

          {/* Async OMR Progress */}
          {jobProgress && (
            <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg space-y-2.5">
              <div className="flex items-center justify-between text-xs font-semibold text-slate-800">
                <span className="inline-flex items-center gap-2">
                  {jobProgress.status === 'completed' ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-600" aria-hidden="true" />
                  ) : (
                    <Loader2 className="w-4 h-4 text-sky-600 animate-spin" aria-hidden="true" />
                  )}
                  <span>{jobProgress.message}</span>
                </span>
                <span className="font-mono-tabular text-slate-600">{jobProgress.progress}%</span>
              </div>
              <div className="w-full h-2 bg-slate-200 rounded-full overflow-hidden">
                <div
                  className="h-full bg-sky-600 transition-all duration-300"
                  style={{ width: `${jobProgress.progress}%` }}
                />
              </div>
            </div>
          )}

          {errorMsg && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs font-medium text-red-700 space-y-2">
              <div className="flex items-start gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
                <span>{errorMsg}</span>
              </div>
              {backendUnavailable && (
                <button
                  type="button"
                  onClick={() => loadXmlIntoStudio(FALLBACK_SAMPLE_XML, pendingFilename)}
                  className="px-3 py-1.5 text-xs font-semibold text-slate-900 bg-white border border-slate-300 hover:bg-slate-50 rounded-md transition-colors"
                >
                  Load Sample Transcribed Etude
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
