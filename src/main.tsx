import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import "./styles.css";

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // 조용히 실패(개발/일부 환경에서 SW 제한)
    });
  });
}

registerServiceWorker();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

