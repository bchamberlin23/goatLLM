import { useState, useRef, useCallback, useEffect } from "react";

// ── Web Speech API helpers ──────────────────────────────────────────────────

interface SpeechRecognitionEvent extends Event {
  readonly resultIndex: number;
  readonly results: SpeechRecognitionResultList;
}

interface SpeechRecognitionErrorEvent extends Event {
  readonly error: string;
  readonly message: string;
}

interface SpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

declare global {
  interface Window {
    SpeechRecognition: new () => SpeechRecognition;
    webkitSpeechRecognition: new () => SpeechRecognition;
  }
}

type SpeechRecognitionCtor = new () => SpeechRecognition;

const SpeechRecognitionCtor: SpeechRecognitionCtor | null =
  (typeof window !== "undefined" &&
    (window.SpeechRecognition || window.webkitSpeechRecognition)) ||
  null;

export function isSpeechRecognitionSupported(): boolean {
  return SpeechRecognitionCtor !== null;
}

// ── Text-to-speech helpers ─────────────────────────────────────────────────

export interface TextToSpeechOptions {
  voiceURI?: string;
  rate?: number;
  pitch?: number;
}

export function isSpeechSynthesisSupported(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;
}

export function stopSpeaking() {
  if (!isSpeechSynthesisSupported()) return;
  window.speechSynthesis.cancel();
}

export function speakText(text: string, options: TextToSpeechOptions = {}): SpeechSynthesisUtterance | undefined {
  if (!isSpeechSynthesisSupported()) {
    throw new Error("Speech synthesis is not supported in this webview.");
  }
  const clean = text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[#*_`>\[\]()]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!clean) return undefined;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(clean);
  utterance.rate = options.rate ?? 1;
  utterance.pitch = options.pitch ?? 1;
  if (options.voiceURI) {
    const voice = window.speechSynthesis.getVoices().find((candidate) => candidate.voiceURI === options.voiceURI);
    if (voice) utterance.voice = voice;
  }
  window.speechSynthesis.speak(utterance);
  return utterance;
}

// ── React hook ───────────────────────────────────────────────────────────────

interface UseSpeechToTextOptions {
  /** Called with interim (partial) transcription as the user speaks. */
  onInterim?: (text: string) => void;
  /** Called with the final transcribed text when the user pauses or stops. */
  onTranscription: (text: string) => void;
  /** Called when an error occurs. */
  onError?: (error: string) => void;
}

interface UseSpeechToTextResult {
  /** Whether we're currently recording. */
  listening: boolean;
  /** Whether the browser supports speech recognition. */
  supported: boolean;
  /** Start recording (requests mic permission if needed). */
  start: () => Promise<void>;
  /** Stop recording and finalize transcription. */
  stop: () => void;
  /** Error message, if any. */
  error: string | null;
  /** Clear any error. */
  clearError: () => void;
}

export function useSpeechToText(opts: UseSpeechToTextOptions): UseSpeechToTextResult {
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [supported] = useState(() => isSpeechRecognitionSupported());
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const finalTranscriptRef = useRef("");
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const clearError = useCallback(() => setError(null), []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      recognitionRef.current?.abort();
    };
  }, []);

  const start = useCallback(async () => {
    if (!SpeechRecognitionCtor) {
      setError(
        "Speech recognition is not supported in this browser. On macOS, try opening the web app in Chrome or Edge. On other platforms, make sure your webview supports the Web Speech API.",
      );
      optsRef.current.onError?.("Speech recognition not supported");
      return;
    }

    setError(null);
    finalTranscriptRef.current = "";

    // Request mic permission explicitly first — this triggers the OS permission
    // dialog (macOS System Preferences, browser prompt, etc.) before we attempt
    // speech recognition. SpeechRecognition.start() alone sometimes fails to
    // show the prompt in certain environments.
    try {
      const permStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // Immediately stop the stream — SpeechRecognition manages its own input
      permStream.getTracks().forEach((t) => t.stop());
    } catch (permErr: any) {
      const msg = permErr?.message ?? String(permErr);
      if (msg.includes("Permission") || msg.includes("NotAllowed") || permErr.name === "NotAllowedError") {
        setError("Microphone access denied. Open System Settings → Privacy & Security → Microphone and enable access for this app, then try again.");
      } else if (msg.includes("NotFound") || permErr.name === "NotFoundError") {
        setError("No microphone found. Connect a microphone and try again.");
      } else {
        setError(`Microphone error: ${msg}`);
      }
      optsRef.current.onError?.(permErr.message ?? String(permErr));
      return;
    }

    try {
      const ctor = SpeechRecognitionCtor;
      if (!ctor) return;
      const recognition = new ctor();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = "en-US";

      recognition.onresult = (event: SpeechRecognitionEvent) => {
        let interim = "";
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const result = event.results[i];
          if (result.isFinal) {
            finalTranscriptRef.current += result[0].transcript;
          } else {
            interim += result[0].transcript;
          }
        }
        // Show final + interim combined
        const combined = finalTranscriptRef.current + interim;
        optsRef.current.onInterim?.(combined);
      };

      recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
        // Don't set error for "no-speech" — it's a normal pause
        if (event.error === "no-speech") return;
        // "aborted" is expected when we call stop()
        if (event.error === "aborted") return;

        let msg = event.message || event.error;
        if (event.error === "not-allowed") {
          msg = "Microphone access denied. Allow microphone access in your system settings.";
        } else if (event.error === "audio-capture") {
          msg = "No microphone found. Connect a microphone and try again.";
        } else if (event.error === "network") {
          msg = "Network error during speech recognition. Check your connection.";
        }
        setError(msg);
        optsRef.current.onError?.(msg);
      };

      recognition.onend = () => {
        // If we didn't manually stop, auto-restart (continuous mode sometimes
        // triggers onend between utterances)
        if (recognitionRef.current === recognition) {
          try {
            recognition.start();
          } catch {
            // Can't restart — likely aborted
            setListening(false);
            recognitionRef.current = null;
            // Finalize whatever we have
            const final = finalTranscriptRef.current.trim();
            if (final) {
              optsRef.current.onTranscription(final);
            }
          }
        }
      };

      recognitionRef.current = recognition;
      recognition.start();
      setListening(true);
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      setError(`Microphone error: ${msg}`);
      optsRef.current.onError?.(msg);
    }
  }, []);

  const stop = useCallback(() => {
    const recognition = recognitionRef.current;
    if (!recognition) return;

    // Remove the ref so onend won't auto-restart
    recognitionRef.current = null;

    // Stop recognition
    try {
      recognition.stop();
    } catch {
      // Already stopped
    }

    setListening(false);

    // Deliver final transcript
    const final = finalTranscriptRef.current.trim();
    if (final) {
      optsRef.current.onTranscription(final);
    }
  }, []);

  return { listening, supported, start, stop, error, clearError };
}
