import { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2, KeyRound, Loader2, LogIn, LogOut, RefreshCw, XCircle } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";

interface CodexAuthStatus {
  signed_in: boolean;
  account_id?: string | null;
  expires?: number | null;
}

interface CodexOAuthStart {
  login_id: string;
  auth_url: string;
  redirect_uri: string;
  callback_server: boolean;
}

type UiState = "idle" | "loading" | "signed-in" | "signed-out" | "error";

export function CodexSubscriptionCard() {
  const [status, setStatus] = useState<CodexAuthStatus | null>(null);
  const [uiState, setUiState] = useState<UiState>("idle");
  const [message, setMessage] = useState<string>("");
  const [loginId, setLoginId] = useState<string | null>(null);
  const [manualInput, setManualInput] = useState("");
  const [manualOpen, setManualOpen] = useState(false);
  const unlistenRef = useRef<(() => void) | null>(null);

  const refreshStatus = useCallback(async () => {
    setUiState("loading");
    setMessage("");
    try {
      const next = await invoke<CodexAuthStatus>("openai_codex_auth_status");
      setStatus(next);
      setUiState(next.signed_in ? "signed-in" : "signed-out");
    } catch (err) {
      setUiState("error");
      setMessage(errorMessage(err));
    }
  }, []);

  useEffect(() => {
    void refreshStatus();
    return () => {
      unlistenRef.current?.();
      unlistenRef.current = null;
    };
  }, [refreshStatus]);

  const startLogin = useCallback(async () => {
    setUiState("loading");
    setMessage("");
    setManualInput("");
    try {
      unlistenRef.current?.();
      unlistenRef.current = null;

      const started = await invoke<CodexOAuthStart>("openai_codex_oauth_start");
      setLoginId(started.login_id);
      setManualOpen(!started.callback_server);

      const { listen } = await import("@tauri-apps/api/event");
      unlistenRef.current = await listen(
        `openai-codex-oauth:${started.login_id}`,
        (event: { payload: unknown }) => {
          const payload = event.payload;
          if (!payload || typeof payload !== "object") return;
          const record = payload as Record<string, unknown>;
          if (record.kind === "signed_in") {
            const next = record.status as CodexAuthStatus;
            setStatus(next);
            setUiState("signed-in");
            setMessage("Signed in");
            setManualOpen(false);
            setLoginId(null);
            unlistenRef.current?.();
            unlistenRef.current = null;
          } else if (record.kind === "error") {
            setUiState("error");
            setMessage(typeof record.message === "string" ? record.message : "Sign in failed");
            setManualOpen(true);
          }
        },
      );

      await openExternal(started.auth_url);
      setUiState("signed-out");
      setMessage(started.callback_server ? "Waiting for browser sign in" : "Paste callback URL");
    } catch (err) {
      setUiState("error");
      setMessage(errorMessage(err));
      setManualOpen(true);
    }
  }, []);

  const completeManual = useCallback(async () => {
    if (!loginId || !manualInput.trim()) return;
    setUiState("loading");
    setMessage("");
    try {
      const next = await invoke<CodexAuthStatus>("openai_codex_oauth_complete", {
        loginId,
        input: manualInput.trim(),
      });
      setStatus(next);
      setUiState("signed-in");
      setMessage("Signed in");
      setManualOpen(false);
      setLoginId(null);
      setManualInput("");
    } catch (err) {
      setUiState("error");
      setMessage(errorMessage(err));
    }
  }, [loginId, manualInput]);

  const signOut = useCallback(async () => {
    setUiState("loading");
    setMessage("");
    try {
      const next = await invoke<CodexAuthStatus>("openai_codex_logout");
      setStatus(next);
      setUiState("signed-out");
      setMessage("Signed out");
      setManualOpen(false);
      setLoginId(null);
    } catch (err) {
      setUiState("error");
      setMessage(errorMessage(err));
    }
  }, []);

  const signedIn = !!status?.signed_in;
  const isLoading = uiState === "loading";
  const expiresLabel = status?.expires ? new Date(status.expires).toLocaleDateString() : null;

  return (
    <div className="soft-card rounded-xl overflow-hidden">
      <div className="flex items-center gap-2.5 px-3 py-2.5">
        <KeyRound size={13} strokeWidth={1.75} className="text-text-3 shrink-0" aria-hidden="true" />
        <span className="text-[13px] font-medium text-text-1">OpenAI Codex</span>
        {signedIn ? (
          <CheckCircle2 size={12} strokeWidth={2} className="text-success shrink-0" aria-hidden="true" />
        ) : uiState === "error" ? (
          <XCircle size={12} strokeWidth={2} className="text-error shrink-0" aria-hidden="true" />
        ) : (
          <span className="w-1.5 h-1.5 rounded-full shrink-0 bg-text-4" />
        )}
        {status?.account_id && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/5 text-text-4 font-mono truncate max-w-[150px]">
            {status.account_id}
          </span>
        )}
        {expiresLabel && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/5 text-text-4 font-mono">
            {expiresLabel}
          </span>
        )}
        {message && (
          <span className={`text-[10px] font-medium ${uiState === "error" ? "text-error" : "text-text-3"}`}>
            {message}
          </span>
        )}
        <div className="flex-1" />
        {loginId && !manualOpen && !signedIn && (
          <button
            className="control-pill px-2 py-1 text-[11px] font-medium rounded-md transition-colors"
            onClick={() => setManualOpen(true)}
            disabled={isLoading}
          >
            Enter code
          </button>
        )}
        <button
          className="control-icon w-6 h-6 flex items-center justify-center rounded transition-colors"
          onClick={refreshStatus}
          disabled={isLoading}
          aria-label="Check OpenAI Codex status"
          title="Check status"
        >
          {isLoading ? (
            <Loader2 size={12} strokeWidth={2} className="animate-spin" />
          ) : (
            <RefreshCw size={12} strokeWidth={2} />
          )}
        </button>
        {signedIn ? (
          <button
            className="control-pill px-2 py-1 text-[11px] font-medium rounded-md transition-colors flex items-center gap-1"
            onClick={signOut}
            disabled={isLoading}
          >
            <LogOut size={11} strokeWidth={1.75} aria-hidden="true" />
            <span>Sign out</span>
          </button>
        ) : (
          <button
            className="control-pill px-2 py-1 text-[11px] font-medium rounded-md transition-colors flex items-center gap-1 bg-accent text-bg hover:bg-accent-hover"
            onClick={startLogin}
            disabled={isLoading}
          >
            <LogIn size={11} strokeWidth={2} aria-hidden="true" />
            <span>Sign in</span>
          </button>
        )}
      </div>

      {manualOpen && loginId && (
        <div className="border-t border-hairline px-3 py-2.5 flex items-center gap-2 bg-black/10">
          <input
            className="flex-1 h-[28px] px-2 bg-white/5 border border-white/10 rounded-md text-[11px] text-text-1 placeholder:text-text-4 font-mono outline-none focus:border-accent/45 focus:ring-1 focus:ring-accent/20"
            value={manualInput}
            onChange={(e) => setManualInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void completeManual();
              }
            }}
            placeholder="Paste redirect URL or code"
            aria-label="OpenAI Codex callback URL or code"
          />
          <button
            className="control-pill px-2.5 py-1.5 rounded-md text-[11px] font-medium transition-colors"
            onClick={completeManual}
            disabled={isLoading || !manualInput.trim()}
          >
            Complete
          </button>
        </div>
      )}
    </div>
  );
}

async function openExternal(url: string) {
  try {
    await invoke("plugin:shell|open", { path: url });
  } catch {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  return "OpenAI Codex request failed";
}
