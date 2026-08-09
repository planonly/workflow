import React, { createContext, useContext, useState, useEffect } from "react";

const ThemeContext = createContext({ theme: "dark", setTheme: () => {} });

// A device-local UI preference, not something that needs to sync across
// devices — localStorage is the right tool here, not Firestore. Falls back
// to dark (the only theme that existed before this) if storage is
// unavailable for any reason, rather than throwing.
export function ThemeProvider({ children }) {
  const [theme, setTheme] = useState(() => {
    try {
      const saved = localStorage.getItem("wfc-theme");
      return saved === "light" || saved === "dark" ? saved : "dark";
    } catch (e) {
      return "dark";
    }
  });

  useEffect(() => {
    try { localStorage.setItem("wfc-theme", theme); } catch (e) { /* storage unavailable, preference just won't persist */ }
  }, [theme]);

  return (
    <ThemeContext.Provider value={{ theme, setTheme }}>
      <div data-theme={theme} style={{ display: "contents" }}>{children}</div>
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
