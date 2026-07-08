import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

import { Capacitor } from "@capacitor/core";
import { StatusBar, Style } from "@capacitor/status-bar";

if (Capacitor.isNativePlatform()) {
  StatusBar.setOverlaysWebView({
    overlay: false,
  });

  StatusBar.setBackgroundColor({
    color: "#070707",
  });

  StatusBar.setStyle({
    style: Style.Dark,
  });
}

document.addEventListener("contextmenu", (e) => {
  e.preventDefault();
});

document.addEventListener("keydown", (e) => {
  if (
    e.key === "F12" ||
    (e.ctrlKey &&
      e.shiftKey &&
      ["I", "J", "C"].includes(e.key.toUpperCase())) ||
    (e.ctrlKey && e.key.toUpperCase() === "U")
  ) {
    e.preventDefault();
  }
});
ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
