"use client";

import { useEffect, useState } from "react";
import { auth, googleProvider } from "@/lib/firebase";
import { onAuthStateChanged, signInWithPopup, signOut, type User } from "firebase/auth";

export function Header() {
  const [user, setUser] = useState<User | null>(null);
  useEffect(() => onAuthStateChanged(auth, (u) => setUser(u)), []);

  return (
    <header className="sticky top-0 z-10 border-b border-blue-100 bg-gradient-to-r from-blue-600 to-blue-500 text-white">
      <div className="mx-auto max-w-5xl px-6 py-3 flex items-center justify-between">
        <div className="text-base sm:text-lg font-semibold tracking-tight">Finance Planner</div>
        <div className="flex items-center gap-3">
          {user ? (
            <>
              <span className="hidden sm:inline text-sm opacity-90">{user.displayName ?? user.email}</span>
              <button
                className="rounded-md bg-white/10 hover:bg-white/20 px-3 py-1 text-sm"
                onClick={() => signOut(auth)}
              >
                Sign out
              </button>
            </>
          ) : (
            <button
              className="rounded-md bg-white text-blue-600 hover:bg-blue-50 px-3 py-1 text-sm"
              onClick={() => signInWithPopup(auth, googleProvider)}
            >
              Sign in
            </button>
          )}
        </div>
      </div>
    </header>
  );
}


