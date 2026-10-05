import "@/styles/globals.css";
import type { AppProps } from "next/app";
import { LocaleProvider } from "@/i18n/provider";

export default function App({ Component, pageProps }: AppProps) {
  return (
    <LocaleProvider>
      <Component {...pageProps} />
    </LocaleProvider>
  );
}
