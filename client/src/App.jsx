import React from "react";
import { Routes, Route, BrowserRouter } from "react-router-dom";
import SharePage   from "./pages/SharePage";
import ReceivePage from "./pages/ReceivePage";

export default function App() {
  return (
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Routes>
        <Route path="/"          element={<SharePage />} />
        <Route path="/r/:roomId" element={<ReceivePage />} />
      </Routes>
    </BrowserRouter>
  );
}