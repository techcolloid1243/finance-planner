"use client";

import { useEffect, useState } from "react";
import { auth, db, googleProvider } from "../firebase";
import {
  signInWithPopup,
  signOut,
  onAuthStateChanged,
  User,
} from "firebase/auth";
import {
  collection,
  addDoc,
  query,
  onSnapshot,
  orderBy,
  serverTimestamp,
} from "firebase/firestore";

export default function Home() {
  const [user, setUser] = useState<User | null>(null);
  const [expenseName, setExpenseName] = useState("");
  const [expenseAmount, setExpenseAmount] = useState("");
  const [expenses, setExpenses] = useState<any[]>([]);

  // Track auth state
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (firebaseUser) => {
      setUser(firebaseUser);
    });
    return () => unsub();
  }, []);

  // Fetch expenses for this user
  useEffect(() => {
    if (!user) return;
    const q = query(
      collection(db, "expenses", user.uid, "items"),
      orderBy("createdAt", "desc")
    );
    const unsub = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      }));
      setExpenses(data);
    });
    return () => unsub();
  }, [user]);

  // Add expense
  const addExpense = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    if (!expenseName || !expenseAmount) return;

    try {
      await addDoc(collection(db, "expenses", user.uid, "items"), {
        name: expenseName,
        amount: parseFloat(expenseAmount),
        createdAt: serverTimestamp(),
      });
      setExpenseName("");
      setExpenseAmount("");
    } catch (err) {
      console.error("Error adding expense:", err);
    }
  };

  // Login
  const login = async () => {
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err) {
      console.error("Login error:", err);
    }
  };

  // Logout
  const logout = async () => {
    await signOut(auth);
  };

  return (
    <main className="flex flex-col items-center justify-center min-h-screen p-8 bg-gray-50">
      <h1 className="text-3xl font-bold mb-6">Finance Planner</h1>

      {!user ? (
        <button
          onClick={login}
          className="px-6 py-3 bg-blue-600 text-white rounded-lg shadow-md hover:bg-blue-700"
        >
          Sign in with Google
        </button>
      ) : (
        <div className="w-full max-w-md">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center space-x-3">
              <img
                src={user.photoURL || ""}
                alt="User"
                className="w-10 h-10 rounded-full"
              />
              <span className="font-medium">{user.displayName}</span>
            </div>
            <button
              onClick={logout}
              className="px-3 py-1 bg-red-500 text-white rounded-md hover:bg-red-600"
            >
              Logout
            </button>
          </div>

          <form
            onSubmit={addExpense}
            className="flex flex-col space-y-3 mb-6 bg-white p-4 rounded-lg shadow"
          >
            <input
              type="text"
              placeholder="Expense Name"
              value={expenseName}
              onChange={(e) => setExpenseName(e.target.value)}
              className="border px-3 py-2 rounded"
            />
            <input
              type="number"
              placeholder="Amount"
              value={expenseAmount}
              onChange={(e) => setExpenseAmount(e.target.value)}
              className="border px-3 py-2 rounded"
            />
            <button
              type="submit"
              className="bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700"
            >
              Add Expense
            </button>
          </form>

          <h2 className="text-xl font-semibold mb-2">Your Expenses</h2>
          <ul className="space-y-2">
            {expenses.map((exp) => (
              <li
                key={exp.id}
                className="flex justify-between bg-white p-3 rounded shadow"
              >
                <span>{exp.name}</span>
                <span className="font-semibold">₹{exp.amount}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </main>
  );
}
