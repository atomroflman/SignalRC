import React, { useEffect, useState } from "react";
import { Geist, Geist_Mono } from "next/font/google";
import CarVideoPanel from "@/components/car-video-panel";
import VideoSettingsControl from "@/components/video-settings";
import { useControlFlowStore } from "@/components/control-flow-store";
import CarControl from "@/components/car-control";
import Telemetry from "@/components/telemetry";
import Ping from "@/components/ping";
import SessionTransfer from "@/components/session-transfer";
import InstallDialog from "@/components/install-dialog";
import LanguageSwitcher from "@/components/language-switcher";
import VersionBanner from "@/components/version-banner";
import GamepadViewer from "@/components/gamepad-viewer";
import CarFunctionsView from "@/components/car-functions-view";
import AudioChat from "@/components/audio-chat";
import SshKeyManager from "@/components/ssh-key-manager";
import SortableSectionList from "@/components/sortable-section-list";
import { useI18n } from "@/i18n/provider";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export default function Home() {
  const { messages } = useI18n();
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const selectedCarId = useControlFlowStore(state => state.carId);
  const carSession = useControlFlowStore(state => state.carSession);

  useEffect(() => {
    fetch("/api/user/me")
      .then(res => res.json())
      .then(data => setUser(data))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">{messages.common.loading}</div>
    );
  }
  if (!user) {
    return (
      <div className="flex items-center justify-center min-h-screen">{messages.home.unauthenticated}</div>
    );
  }

  const rightSections = [
    {
      id: "vehicle",
      title: messages.carControl.vehicle,
      content: <CarControl />,
      visible: true,
    },
    {
      id: "sshKey",
      title: messages.sshKeyManager.sectionTitle,
      content: selectedCarId ? <SshKeyManager carId={selectedCarId} /> : null,
      visible: Boolean(selectedCarId && !carSession),
    },
    {
      id: "gamepadViewer",
      title: messages.gamepadViewer.title,
      content: selectedCarId ? <GamepadViewer hideFlowButtons={true} /> : null,
      visible: Boolean(selectedCarId),
    },
    {
      id: "carFunctions",
      title: messages.carFunctions.title,
      content: selectedCarId ? <CarFunctionsView carId={selectedCarId} hideFlowButtons={true} /> : null,
      visible: Boolean(selectedCarId),
    },
    {
      id: "audioChat",
      title: messages.audioChat.title,
      content: selectedCarId ? <AudioChat carId={selectedCarId} /> : null,
      visible: Boolean(selectedCarId),
    },
    {
      id: "sessionTransfer",
      title: messages.sessionTransfer.title,
      content: selectedCarId ? <SessionTransfer /> : null,
      visible: Boolean(selectedCarId),
    },
    {
      id: "videoSettings",
      title: messages.videoSettings.title,
      content: selectedCarId ? (
        <VideoSettingsControl
          carId={selectedCarId}
          canManageEnabled={Boolean(user?.loginName && selectedCarId && carSession)}
        />
      ) : null,
      visible: Boolean(selectedCarId),
    },
    {
      id: "ping",
      title: messages.ping.title,
      content: selectedCarId ? <Ping /> : null,
      visible: Boolean(selectedCarId),
    },
  ];

  return (
    <div
      className={`${geistSans.className} ${geistMono.className} h-screen overflow-hidden bg-[linear-gradient(180deg,#101217_0%,#17191f_46%,#111319_100%)] text-slate-100`}
    >
      <div className="relative isolate h-full overflow-hidden">
        <div className="pointer-events-none absolute left-[-8rem] top-[-7rem] h-64 w-64 rounded-full bg-slate-700/16 blur-3xl" />
        <div className="pointer-events-none absolute bottom-[-9rem] right-[-5rem] h-72 w-72 rounded-full bg-slate-700/18 blur-3xl" />

        <div className="relative flex h-full flex-col overflow-hidden bg-[linear-gradient(180deg,rgba(23,25,31,0.98),rgba(15,17,22,0.96))] shadow-[0_28px_80px_rgba(0,0,0,0.35)] backdrop-blur-xl">
          <div className="flex items-center justify-between px-5 py-4 md:px-6">
            <div className="text-[11px] font-semibold uppercase tracking-[0.34em] text-sky-300">
              {messages.home.title}
            </div>
            <div className="flex items-center gap-2">
              <LanguageSwitcher className="shrink-0" />
              <div className="hidden items-center gap-2 md:flex">
              {!selectedCarId && <InstallDialog />}
              <div className="rounded-full bg-slate-800/90 px-3 py-2 text-[11px] font-medium text-slate-300 shadow-sm ring-1 ring-white/10">
                {selectedCarId ? messages.home.activeVehicle(selectedCarId) : messages.home.noVehicleSelected}
              </div>
              </div>
            </div>
          </div>

          <div className="flex flex-1 min-h-0 flex-col lg:flex-row">
            <div className="flex min-h-0 flex-1 flex-col p-4 md:p-5">
              {selectedCarId && <VersionBanner carId={selectedCarId} />}
              <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-[28px] border border-white/8 bg-[linear-gradient(180deg,rgba(9,11,16,0.94),rgba(18,20,28,0.92))] shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]">
                <CarVideoPanel carId={selectedCarId} />
              </div>
            </div>

            <div className="w-full min-h-0 border-t border-white/8 bg-[linear-gradient(180deg,rgba(23,27,37,0.92),rgba(17,20,28,0.94))] lg:w-[24rem] lg:border-l lg:border-t-0 lg:border-white/8">
              <div className="h-full min-h-0 px-3 py-3">
                <SortableSectionList storageKey="rightPanel" items={rightSections} />
              </div>
            </div>
          </div>

          {selectedCarId && (
            <div className="border-t border-white/8 bg-slate-950/40 px-3 py-3 backdrop-blur-sm">
              <div className="min-h-24 border border-white/8 bg-slate-900/70 shadow-sm">
                <Telemetry carId={selectedCarId} />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
