import "@/styles/globals.css";
import { useEffect } from "react";
import type { AppProps } from "next/app";
import { LocaleProvider } from "@/i18n/provider";

export default function App({ Component, pageProps }: AppProps) {
  // HUD control display of the driver (AP13): lives across page changes like the flow store.
  useEffect(() => {
    let stop: (() => void) | undefined;
    let cancelled = false;
    void import("@/components/overlay/integration/driver-control-display").then((m) => {
      if (!cancelled) stop = m.startDriverControlDisplay();
    });
    return () => {
      cancelled = true;
      stop?.();
    };
  }, []);
  return (
    <LocaleProvider>
      <Component {...pageProps} />
    </LocaleProvider>
  );
}
