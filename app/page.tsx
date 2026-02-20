"use client";

import dynamic from "next/dynamic";

const App = dynamic(() => import("@/components/Speak23D"), { ssr: false });

export default function Home() {
  return <App />;
}
