import { create } from "zustand";
import { persist } from "zustand/middleware";

// Example Zustand slice. Client-only UI state lives here; anything that comes
// from the database belongs in React Query instead.
type UiState = {
  sidebarOpen: boolean;
  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;
};

export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      sidebarOpen: true,
      toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
      setSidebarOpen: (open) => set({ sidebarOpen: open }),
    }),
    { name: "prompt-ops-ui" },
  ),
);
