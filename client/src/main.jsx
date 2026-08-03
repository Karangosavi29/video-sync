import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import "./index.css";
import Controller from "./pages/Controller.jsx";
import Display from "./pages/Display.jsx";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/controller" replace />} />
        <Route path="/controller" element={<Controller />} />
        <Route path="/display/:id" element={<Display />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>
);
