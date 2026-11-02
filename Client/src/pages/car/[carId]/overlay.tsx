import React from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/router";
import { useI18n } from "@/i18n/provider";

// Client only: IndexedDB backups, SignalR and the video player need the browser.
const OverlayEditorPage = dynamic(() => import("@/components/overlay/integration/editor-page"), { ssr: false });

export default function CarOverlayEditorRoute() {
  const { messages } = useI18n();
  const router = useRouter();
  const carId = typeof router.query.carId === "string" ? parseInt(router.query.carId, 10) : NaN;
  if (!Number.isInteger(carId) || carId <= 0) {
    return <div className="p-8 text-zinc-300">{messages.common.loading}</div>;
  }
  return <OverlayEditorPage key={carId} carId={carId} />;
}
