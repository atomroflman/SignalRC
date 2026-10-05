import React, { JSX, useEffect, useRef, useState } from "react";
import CollapsibleSection from "./collapsible-section";
import { useI18n } from "@/i18n/provider";

type DiagnosticStatus = "Ok" | "Warning" | "Error" | "Info";

interface DiagnosticCheck {
  step: string;
  title: string;
  status: DiagnosticStatus;
  message: string;
}

interface OnboardDiagnosticsReport {
  timestamp: string;
  streamName: string;
  checks: DiagnosticCheck[];
  hasErrors: boolean;
}

interface Props {
  carId?: number;
}

const statusClasses: Record<DiagnosticStatus, string> = {
  Ok: "bg-green-900/40 border-green-700 text-green-100",
  Warning: "bg-amber-900/40 border-amber-700 text-amber-100",
  Error: "bg-red-900/40 border-red-700 text-red-100",
  Info: "bg-blue-900/40 border-blue-700 text-blue-100",
};

const statusDot: Record<DiagnosticStatus, string> = {
  Ok: "bg-green-500",
  Warning: "bg-amber-500",
  Error: "bg-red-500",
  Info: "bg-blue-500",
};

export default function OnboardDiagnostics(props: Props): JSX.Element {
  const { messages } = useI18n();
  const { carId } = props;
  const [connection, setConnection] = useState<any>(undefined);
  const [report, setReport] = useState<OnboardDiagnosticsReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    let mounted = true;
    let conn: any;

    (async () => {
      try {
        const signalR = await import("@microsoft/signalr");
        conn = new signalR.HubConnectionBuilder()
          .withUrl("/hubs/connection")
          .withAutomaticReconnect()
          .build();

        await conn.start();
        if (!mounted) {
          try { await conn.stop(); } catch {}
          return;
        }
        setConnection(conn);
      } catch (err: any) {
        console.error("Failed to connect diagnostics hub:", err);
        if (mounted) {
          setError(messages.onboardDiagnostics.connectionFailed);
        }
      }
    })();

    return () => {
      mounted = false;
      if (conn) {
        try { conn.stop(); } catch {}
      }
      setConnection(undefined);
    };
  }, [messages.onboardDiagnostics.connectionFailed]);

  const runDiagnostics = React.useCallback(async (startTest = false) => {
    if (!connection || !carId) {
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const method = startTest ? "RunOnboardStartupTest" : "GetOnboardDiagnostics";
      const result = await connection.invoke(method, carId) as OnboardDiagnosticsReport;
      setReport(result);
    } catch (err: any) {
      console.error("Failed to get onboard diagnostics:", err);
      setError(messages.onboardDiagnostics.loadFailed);
    } finally {
      setLoading(false);
    }
  }, [connection, carId, messages.onboardDiagnostics.loadFailed]);

  useEffect(() => {
    if (autoRefresh && connection && carId) {
      runDiagnostics(false);
      intervalRef.current = setInterval(() => runDiagnostics(false), 10000);
    }
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [autoRefresh, connection, carId, runDiagnostics]);

  const overallStatus = report?.hasErrors
    ? "Error"
    : report?.checks.some(c => c.status === "Warning")
      ? "Warning"
      : report
        ? "Ok"
        : null;

  return (
    <CollapsibleSection
      title={messages.onboardDiagnostics.title}
      label={messages.onboardDiagnostics.title}
      defaultCollapsed={true}
      className="px-2"
    >
      <div className="space-y-2 text-xs leading-tight">
        {!carId && (
          <div className="text-zinc-400">{messages.onboardDiagnostics.noCar}</div>
        )}

        {carId && (
          <div className="flex flex-wrap items-center gap-2">
            <button
              className="px-2 py-1 rounded bg-zinc-700 hover:bg-zinc-600 text-zinc-100 disabled:opacity-50"
              onClick={() => runDiagnostics(false)}
              disabled={loading || !connection}
            >
              {loading ? messages.onboardDiagnostics.running : messages.onboardDiagnostics.refresh}
            </button>
            <button
              className="px-2 py-1 rounded bg-blue-800 hover:bg-blue-700 text-zinc-100 disabled:opacity-50"
              onClick={() => runDiagnostics(true)}
              disabled={loading || !connection}
              title={messages.onboardDiagnostics.startTestHint}
            >
              {messages.onboardDiagnostics.startTest}
            </button>
            <label className="flex items-center gap-1 text-zinc-300 cursor-pointer">
              <input
                type="checkbox"
                checked={autoRefresh}
                onChange={(e) => setAutoRefresh(e.target.checked)}
                disabled={!connection}
              />
              {messages.onboardDiagnostics.autoRefresh}
            </label>
          </div>
        )}

        {error && (
          <div className="p-2 border border-red-800 bg-red-950 text-red-200 rounded">
            {error}
          </div>
        )}

        {overallStatus && (
          <div className={`inline-flex items-center gap-2 px-2 py-1 rounded border ${statusClasses[overallStatus]}`}>
            <span className={`w-2 h-2 rounded-full ${statusDot[overallStatus]}`} />
            <span>
              {overallStatus === "Ok"
                ? messages.onboardDiagnostics.allOk
                : overallStatus === "Warning"
                  ? messages.onboardDiagnostics.hasWarnings
                  : messages.onboardDiagnostics.hasErrors}
            </span>
            {report?.streamName && (
              <span className="text-zinc-400">· {report.streamName}</span>
            )}
            {report?.timestamp && (
              <span className="text-zinc-500">· {new Date(report.timestamp).toLocaleTimeString()}</span>
            )}
          </div>
        )}

        {report && report.checks.length === 0 && (
          <div className="text-zinc-400">{messages.onboardDiagnostics.noChecks}</div>
        )}

        {report && report.checks.length > 0 && (
          <div className="space-y-1 max-h-96 overflow-y-auto">
            {report.checks.map((check, idx) => (
              <div
                key={idx}
                className={`border rounded p-2 ${statusClasses[check.status]}`}
              >
                <div className="flex items-center gap-2 mb-0.5">
                  <span className={`w-2 h-2 rounded-full ${statusDot[check.status]}`} />
                  <span className="font-medium">{check.title}</span>
                  <span className="text-[10px] opacity-70">#{check.step}</span>
                </div>
                <div className="pl-4 text-[11px] opacity-90">{check.message}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </CollapsibleSection>
  );
}
