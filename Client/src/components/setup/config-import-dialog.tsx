import React from "react";
import { useI18n } from "@/i18n/provider";
import { importVehicleConfig, parseConfigFile, planHasChanges, type ImportPlan } from "./config-export";

const btnPrimary = "px-2 py-1 bg-green-900 hover:bg-green-800 text-green-100 rounded text-xs border border-green-800 disabled:opacity-40 disabled:cursor-not-allowed";
const btnGhost = "px-2 py-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded text-xs border border-zinc-700 disabled:opacity-40 disabled:cursor-not-allowed";

/**
 * "Konfiguration importieren": pick a file, see what it would add, change and remove, then
 * apply. Nothing is written before the confirmation.
 */
export function ConfigImportButton({ carId, onImported }: { carId: number; onImported: () => void }) {
  const { messages } = useI18n();
  const t = messages.setupPage.configImport;
  const input = React.useRef<HTMLInputElement>(null);
  const [file, setFile] = React.useState<unknown>(null);
  const [fileName, setFileName] = React.useState("");
  const [plan, setPlan] = React.useState<ImportPlan | null>(null);
  const [removeMissing, setRemoveMissing] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const close = () => { setFile(null); setPlan(null); setError(null); setRemoveMissing(false); };

  const preview = async (content: unknown, remove: boolean) => {
    setBusy(true);
    setError(null);
    try {
      setPlan(await importVehicleConfig(carId, content, { dryRun: true, removeMissing: remove }));
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setBusy(false);
    }
  };

  const pick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    setFileName(f.name);
    try {
      const content = parseConfigFile(await f.text());
      setFile(content);
      await preview(content, false);
    } catch (err: any) {
      setFile({});
      setError(`${t.invalidFile}: ${String(err?.message ?? err)}`);
    }
  };

  const apply = async () => {
    setBusy(true);
    setError(null);
    try {
      await importVehicleConfig(carId, file, { dryRun: false, removeMissing });
      close();
      onImported();
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setBusy(false);
    }
  };

  const list = (names: string[], cls: string) => names.length === 0 ? null : (
    <span className={cls}>{names.join(", ")}</span>
  );

  return (
    <>
      <button className={btnGhost} title={t.hint} onClick={() => input.current?.click()}>{t.button}</button>
      <input ref={input} type="file" accept="application/json,.json" className="hidden" onChange={pick} />
      {file !== null && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
          <div className="bg-zinc-900 border border-zinc-700 rounded-lg shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto p-5 text-zinc-100 text-xs space-y-3">
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold">{t.title}</div>
              <button onClick={close} className="text-zinc-400 hover:text-white" aria-label={t.cancel}>✕</button>
            </div>
            <div className="text-zinc-400">{fileName}</div>
            {plan && (
              <>
                <div className="text-zinc-300">
                  {t.source(plan.sourceCarName ?? `#${plan.sourceCarId}`, plan.exportedAt ? new Date(plan.exportedAt).toLocaleString() : "?")}
                  {plan.sourceCarId !== carId && <div className="mt-1 text-amber-300">{t.otherVehicle}</div>}
                </div>
                <table className="w-full border-collapse">
                  <thead>
                    <tr className="text-left text-zinc-400">
                      <th className="py-1 pr-2 font-normal">{t.area}</th>
                      <th className="py-1 pr-2 font-normal">{t.added}</th>
                      <th className="py-1 pr-2 font-normal">{t.changed}</th>
                      <th className="py-1 pr-2 font-normal">{removeMissing ? t.removed : t.notInFile}</th>
                      <th className="py-1 font-normal">{t.unchanged}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {plan.sections.map(s => (
                      <tr key={s.kind} className="border-t border-zinc-800 align-top">
                        <td className="py-1 pr-2 text-zinc-300 whitespace-nowrap">{(t.kinds as Record<string, string>)[s.kind] ?? s.kind}</td>
                        <td className="py-1 pr-2">{list(s.added, "text-green-300") ?? "–"}</td>
                        <td className="py-1 pr-2">{list(s.changed, "text-sky-300") ?? "–"}</td>
                        <td className="py-1 pr-2">{list(s.missing, removeMissing ? "text-red-300 line-through" : "text-zinc-400") ?? "–"}</td>
                        <td className="py-1 text-zinc-500">{s.unchanged.length}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="text-zinc-300">{plan.audioChanged ? t.audioChanged : t.audioSame}</div>
                <label className="flex items-start gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={removeMissing}
                    disabled={busy}
                    onChange={e => { setRemoveMissing(e.target.checked); void preview(file, e.target.checked); }}
                  />
                  <span>{t.removeMissing}</span>
                </label>
                {removeMissing && plan.flowNodesRemoved > 0 && <div className="text-red-300">{t.flowNodesRemoved(plan.flowNodesRemoved)}</div>}
                {!planHasChanges(plan) && <div className="text-zinc-400">{t.nothingToDo}</div>}
              </>
            )}
            {error && <div className="text-red-300 whitespace-pre-wrap">{error}</div>}
            <div className="flex justify-end gap-2 pt-1">
              <button className={btnGhost} onClick={close}>{t.cancel}</button>
              <button className={btnPrimary} disabled={busy || !plan || !planHasChanges(plan)} onClick={apply}>{busy ? t.working : t.apply}</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
