// src/App.jsx
import React from "react";
import { Routes, Route, BrowserRouter } from "react-router-dom";
import SharePage    from "./pages/SharePage";
import ReceivePage  from "./pages/ReceivePage";
import LoginPage    from "./pages/LoginPage";
import AuthGuard    from "./components/AuthGuard";

export default function App() {
  return (
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Routes>
        {/* Public — login page */}
        <Route path="/login" element={<LoginPage />} />

        {/* Protected — must be logged in */}
        <Route
          path="/"
          element={
            <AuthGuard>
              <SharePage />
            </AuthGuard>
          }
        />
        <Route
          path="/r/:roomId"
          element={
            <AuthGuard>
              <ReceivePage />
            </AuthGuard>
          }
        />
      </Routes>
    </BrowserRouter>
  );
}