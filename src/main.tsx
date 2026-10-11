import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "@fontsource-variable/roboto-flex";
import "./styles/globals.css";
import { App } from "./App";

if (import.meta.env.DEV) {
  const shot = new URLSearchParams(location.search).get("shot");
  if (shot) {
    const img = new Image();
    img.src = `/__delay?ms=${shot}`;
    img.style.display = "none";
    document.body.appendChild(img);
  }
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { refetchOnWindowFocus: false, retry: 0 },
  },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
