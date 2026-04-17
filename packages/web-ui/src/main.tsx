import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./theme.css";
import { App } from "./App.js";

const container = document.getElementById("root");
if (!container) {
  throw new Error("Root element #root not found. Ensure index.html contains <div id='root'></div>.");
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>
);
