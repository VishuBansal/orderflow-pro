import { createContext, useContext, useState } from "react";

const AuthCtx = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    try { return JSON.parse(sessionStorage.getItem("crm_user")); } catch { return null; }
  });

  const login = (u) => { sessionStorage.setItem("crm_user", JSON.stringify(u)); setUser(u); };
  const logout = () => { sessionStorage.removeItem("crm_user"); setUser(null); };

  return <AuthCtx.Provider value={{ user, login, logout }}>{children}</AuthCtx.Provider>;
}

export const useAuth = () => useContext(AuthCtx);
