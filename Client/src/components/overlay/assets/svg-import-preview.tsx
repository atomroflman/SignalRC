'use client';

// AP07 – reusable import preview. It shows only the server-sanitized output,
// as an image (no script, no external loads), and requires an explicit
// confirmation. The original file is never rendered. Editor wiring: AP09/AP13.
import { assetMessages, type AssetLocale } from "./messages";
import { assetImageUrl, isNormalizedAssetSvg } from "./svg-asset";
import type { AssetUploadResult, SvgImportState, SvgReportEntry } from "./types";

export interface SvgImportPreviewProps {
  state: SvgImportState;
  /** Called only for an accepted result after the user confirmed. */
  onConfirm: (result: AssetUploadResult) => void;
  onCancel: () => void;
  locale?: AssetLocale;
}

function formatNumber(value: number, locale: AssetLocale): string {
  return value.toLocaleString(locale === "de" ? "de-DE" : "en-US", { maximumFractionDigits: 1, useGrouping: false });
}

function ReportList({ report, locale }: { report: SvgReportEntry[]; locale: AssetLocale }) {
  const m = assetMessages[locale];
  return (
    <ul className="space-y-1 text-xs" data-testid="svg-import-report">
      {report.map(entry => (
        <li key={entry.code} className="text-zinc-300">
          <span className="text-zinc-500">{m.count(entry.count)}</span>{" "}
          {m.codes[entry.code] ?? m.unknownCode(entry.code)}
          {entry.examples.length > 0 && (
            <span className="text-zinc-500"> ({entry.examples.join(", ")})</span>
          )}
        </li>
      ))}
    </ul>
  );
}

export function SvgImportPreview({ state, onConfirm, onCancel, locale = "de" }: SvgImportPreviewProps) {
  const m = assetMessages[locale];
  const accepted = state.kind === "accepted" && isNormalizedAssetSvg(state.result.svg) ? state.result : null;
  const findings = state.kind === "accepted" ? state.result.report.filter(e => !e.code.startsWith("SVG_REJECTED_")) : [];

  return (
    <div className="bg-zinc-900 border border-zinc-700 rounded p-3 text-sm space-y-3" data-testid="svg-import-preview">
      <div className="font-bold text-zinc-200">
        {m.title}
        {state.fileName && <span className="font-normal text-zinc-500"> – {state.fileName}</span>}
      </div>

      {state.kind === "uploading" && <div className="text-zinc-400">{m.uploading}</div>}

      {accepted && (
        <>
          <div className="flex justify-center bg-[repeating-conic-gradient(#3f3f46_0%_25%,#27272a_0%_50%)] bg-[length:16px_16px] rounded p-2">
            {/* eslint-disable-next-line @next/next/no-img-element -- data URL of the sanitized asset; an img never runs script */}
            <img
              src={assetImageUrl(accepted.svg)}
              alt={m.previewAlt}
              className="max-h-64 max-w-full"
              style={{ aspectRatio: `${accepted.metadata.width} / ${accepted.metadata.height}` }}
              draggable={false}
            />
          </div>
          <div className="text-xs text-zinc-500">{m.previewNote}</div>
          <div className="text-xs text-zinc-400">
            {m.size(formatNumber(accepted.metadata.width, locale), formatNumber(accepted.metadata.height, locale))}
            {" · "}
            {m.parts(Object.keys(accepted.metadata.parts).length)}
          </div>
          {findings.length > 0 ? (
            <div>
              <div className="text-xs font-semibold text-zinc-300 mb-1">{m.changes}</div>
              <ReportList report={findings} locale={locale} />
            </div>
          ) : (
            <div className="text-xs text-zinc-400">{m.noChanges}</div>
          )}
        </>
      )}

      {state.kind === "rejected" && (
        <div className="space-y-1" role="alert">
          <div className="text-red-400 font-semibold">
            {m.rejected}: {m.codes[state.code] ?? m.unknownCode(state.code)}
          </div>
          <ReportList report={state.report} locale={locale} />
        </div>
      )}

      {(state.kind === "failed" || (state.kind === "accepted" && !accepted)) && (
        <div className="text-red-400" role="alert">
          {m.failed}
          {state.kind === "failed" && state.code && `: ${m.errors[state.code] ?? state.code}`}
        </div>
      )}

      <div className="flex justify-end gap-2">
        <button type="button" className="px-3 py-1 rounded bg-zinc-700 text-zinc-200 hover:bg-zinc-600" onClick={onCancel}>
          {m.cancel}
        </button>
        {accepted && (
          <button
            type="button"
            className="px-3 py-1 rounded bg-blue-600 text-white hover:bg-blue-500"
            onClick={() => onConfirm(accepted)}
          >
            {m.confirm}
          </button>
        )}
      </div>
    </div>
  );
}
