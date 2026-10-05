import { Html, Head, Main, NextScript } from "next/document";

export default function Document() {
  return (
    <Html lang="de">
    <Head>
      <script src="/adapter.js" />
    </Head>
      <body className="antialiased">      
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}
