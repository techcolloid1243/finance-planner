"use client";

import { useEffect, useMemo, useState } from "react";
import { auth, db } from "@/lib/firebase";
import { onAuthStateChanged, type User } from "firebase/auth";
import { doc, getDoc, setDoc } from "firebase/firestore";
import {
  Chart as ChartJS,
  ArcElement,
  Tooltip as ChartTooltip,
  Legend as ChartLegend,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
} from "chart.js";
import dynamic from "next/dynamic";
import * as XLSX from "xlsx";
import { saveAs } from "file-saver";

const Pie = dynamic(() => import("react-chartjs-2").then((m) => m.Pie), { ssr: false });
const Line = dynamic(() => import("react-chartjs-2").then((m) => m.Line), { ssr: false });

if (typeof window !== "undefined") {
  ChartJS.register(ArcElement, ChartTooltip, ChartLegend, CategoryScale, LinearScale, PointElement, LineElement);
}

type MonthlyEntry = {
  id: string;
  month: string; // YYYY-MM
  savings: number; // combined or you can treat as family savings added that month
  expenses: number;
  savingsType?: string;
  expenseType?: string;
  comment?: string;
};

type FinanceState = {
  myMonthlyIncome: number;
  spouseMonthlyIncome: number;
  myTotalSavings: number;
  spouseTotalSavings: number;
  entries: MonthlyEntry[];
  savingsHoldings: SavingsHolding[];
  insurances: InsuranceItem[];
};

type SavingsHolding = {
  id: string;
  type: string;
  amount: number;
};

type InsuranceItem = {
  id: string;
  type: InsuranceType;
  coveredPeople: string; // free text
  limit: number;
};

type InsuranceType = "Company Health" | "Term" | "Personal Health" | "Parents Health";

const STORAGE_KEY = "finance_planner_state_v2";

const SAVINGS_TYPES = [
  "MF",
  "Stocks",
  "Gold",
  "Property",
  "Cash",
  "FD",
  "Crypto",
  "Other",
] as const;

const EXPENSE_TYPES = [
  "Rent",
  "Groceries",
  "Utilities",
  "Transport",
  "Education",
  "Entertainment",
  "Healthcare",
  "Misc",
] as const;

const defaultState: FinanceState = {
  myMonthlyIncome: 0,
  spouseMonthlyIncome: 0,
  myTotalSavings: 0,
  spouseTotalSavings: 0,
  entries: [],
  savingsHoldings: [],
  insurances: [],
};

function formatCurrency(value: number): string {
  if (!Number.isFinite(value)) return "-";
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(value);
}

function parseNumber(input: string): number {
  const n = Number(input.replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

export default function Home() {
  const [state, setState] = useState<FinanceState>(defaultState);
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      if (u) {
        // Load from Firestore
        const ref = doc(db, "users", u.uid);
        const snap = await getDoc(ref);
        if (snap.exists()) {
          const data = snap.data() as Partial<FinanceState>;
          setState({ ...defaultState, ...data, entries: data.entries ?? [], savingsHoldings: data.savingsHoldings ?? [], insurances: data.insurances ?? [] });
        } else {
          // Migrate from localStorage if present
          try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (raw) {
              const parsed = JSON.parse(raw) as FinanceState;
              setState({ ...defaultState, ...parsed, entries: parsed.entries ?? [] });
              await setDoc(ref, parsed);
            }
          } catch {}
        }
      } else {
        // Anonymous: use localStorage
        try {
          const raw = localStorage.getItem(STORAGE_KEY);
          if (raw) {
            const parsed = JSON.parse(raw) as FinanceState;
            setState({ ...defaultState, ...parsed, entries: parsed.entries ?? [] });
          } else {
            setState(defaultState);
          }
        } catch {
          setState(defaultState);
        }
      }
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    // Persist to localStorage always
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch {}
    // If signed in, also persist to Firestore
    async function save() {
      if (!user) return;
      try {
        const ref = doc(db, "users", user.uid);
        await setDoc(ref, state, { merge: true });
      } catch {}
    }
    save();
  }, [state]);

  const combinedMonthlyIncome = useMemo(
    () => state.myMonthlyIncome + state.spouseMonthlyIncome,
    [state.myMonthlyIncome, state.spouseMonthlyIncome]
  );

  const combinedTotalSavings = useMemo(
    () => state.myTotalSavings + state.spouseTotalSavings,
    [state.myTotalSavings, state.spouseTotalSavings]
  );

  const totalPlannedMonthlySavings = useMemo(
    () => state.entries.reduce((sum, e) => sum + e.savings, 0),
    [state.entries]
  );

  const totalPlannedMonthlyExpenses = useMemo(
    () => state.entries.reduce((sum, e) => sum + e.expenses, 0),
    [state.entries]
  );

  const [projectionMonths, setProjectionMonths] = useState<number>(12);

  const projectedSavingsOnly = useMemo(
    () => combinedTotalSavings + projectionMonths * totalPlannedMonthlySavings,
    [combinedTotalSavings, projectionMonths, totalPlannedMonthlySavings]
  );

  function upsertNumber<K extends keyof FinanceState>(key: K, value: number) {
    setState((prev) => ({ ...prev, [key]: value }));
  }

  function addOrUpdateEntry(entry?: Partial<MonthlyEntry>) {
    const id = entry?.id ?? crypto.randomUUID();
    const next: MonthlyEntry = {
      id,
      month: entry?.month ?? new Date().toISOString().slice(0, 7),
      savings: Number.isFinite(entry?.savings as number) ? (entry!.savings as number) : 0,
      expenses: Number.isFinite(entry?.expenses as number) ? (entry!.expenses as number) : 0,
      savingsType: entry?.savingsType ?? (entry?.savings ? "MF" : undefined),
      expenseType: entry?.expenseType ?? (entry?.expenses ? "Misc" : undefined),
      comment: entry?.comment ?? "",
    };
    setState((prev) => {
      const exists = prev.entries.some((e) => e.id === id);
      const entries = exists
        ? prev.entries.map((e) => (e.id === id ? next : e))
        : [next, ...prev.entries];
      return { ...prev, entries };
    });
  }

  function removeEntry(id: string) {
    setState((prev) => ({ ...prev, entries: prev.entries.filter((e) => e.id !== id) }));
  }

  function addOrUpdateHolding(holding?: Partial<SavingsHolding>) {
    const id = holding?.id ?? crypto.randomUUID();
    const next: SavingsHolding = {
      id,
      type: holding?.type ?? "MF",
      amount: Number.isFinite(holding?.amount as number) ? (holding!.amount as number) : 0,
    };
    setState((prev) => {
      const exists = prev.savingsHoldings.some((h) => h.id === id);
      const savingsHoldings = exists
        ? prev.savingsHoldings.map((h) => (h.id === id ? next : h))
        : [next, ...prev.savingsHoldings];
      return { ...prev, savingsHoldings };
    });
  }

  function removeHolding(id: string) {
    setState((prev) => ({ ...prev, savingsHoldings: prev.savingsHoldings.filter((h) => h.id !== id) }));
  }

  function addOrUpdateInsurance(item?: Partial<InsuranceItem>) {
    const id = item?.id ?? crypto.randomUUID();
    const next: InsuranceItem = {
      id,
      type: (item?.type as InsuranceType) ?? "Company Health",
      coveredPeople: item?.coveredPeople ?? "",
      limit: Number.isFinite(item?.limit as number) ? (item!.limit as number) : 0,
    };
    setState((prev) => {
      const exists = prev.insurances.some((i) => i.id === id);
      const insurances = exists ? prev.insurances.map((i) => (i.id === id ? next : i)) : [next, ...prev.insurances];
      return { ...prev, insurances };
    });
  }

  function removeInsurance(id: string) {
    setState((prev) => ({ ...prev, insurances: prev.insurances.filter((i) => i.id !== id) }));
  }

  function exportToExcel() {
    const incomes = [
      { label: "My Monthly Income", amount: state.myMonthlyIncome },
      { label: "Spouse Monthly Income", amount: state.spouseMonthlyIncome },
      { label: "My Total Savings", amount: state.myTotalSavings },
      { label: "Spouse Total Savings", amount: state.spouseTotalSavings },
    ];

    const entries = state.entries.map((e) => ({
      Month: e.month,
      Savings: e.savings,
      "Savings Type": e.savingsType ?? "",
      Expenses: e.expenses,
      "Expense Type": e.expenseType ?? "",
      Net: e.savings - e.expenses,
      Comment: e.comment ?? "",
    }));

    const holdings = state.savingsHoldings.map((h) => ({ Type: h.type, Amount: h.amount }));

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(incomes), "Summary");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(entries), "Monthly Entries");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(holdings), "Holdings");

    const wbout = XLSX.write(wb, { bookType: "xlsx", type: "array" });
    const blob = new Blob([wbout], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const filename = `finance-planner-${new Date().toISOString().slice(0, 10)}.xlsx`;
    saveAs(blob, filename);
  }

  return (
    <div className="min-h-screen">
      <main className="mx-auto max-w-5xl p-6 sm:p-10">
        <h1 className="text-2xl sm:text-3xl font-semibold mb-6 text-slate-900">Finance Planner</h1>

        <section className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
          <div className="rounded-lg border border-neutral-200 dark:border-neutral-800 p-4 card p-4">
            <h2 className="text-lg font-medium mb-4">Monthly Income</h2>
            <div className="grid grid-cols-1 gap-4">
              <label className="grid gap-1">
                <span className="text-sm text-neutral-600 dark:text-neutral-400">My monthly income</span>
                <input
                  inputMode="decimal"
                  className="w-full rounded-md border border-neutral-300 dark:border-neutral-700 bg-transparent px-3 py-2 outline-none focus:ring-2 focus:ring-blue-500"
                  value={state.myMonthlyIncome}
                  onChange={(e) => upsertNumber("myMonthlyIncome", parseNumber(e.target.value))}
                  placeholder="0"
                />
              </label>
              <label className="grid gap-1">
                <span className="text-sm text-neutral-600 dark:text-neutral-400">Spouse monthly income</span>
                <input
                  inputMode="decimal"
                  className="w-full rounded-md border border-neutral-300 dark:border-neutral-700 bg-transparent px-3 py-2 outline-none focus:ring-2 focus:ring-blue-500"
                  value={state.spouseMonthlyIncome}
                  onChange={(e) => upsertNumber("spouseMonthlyIncome", parseNumber(e.target.value))}
                  placeholder="0"
                />
              </label>
            </div>
            <div className="mt-4 text-sm text-neutral-700 dark:text-neutral-300">
              Combined monthly income: <span className="font-medium">{formatCurrency(combinedMonthlyIncome)}</span>
            </div>
          </div>

          <div className="rounded-lg border border-neutral-200 dark:border-neutral-800 p-4 card p-4">
            <h2 className="text-lg font-medium mb-4">Total Savings and Assets</h2>
            <div className="grid grid-cols-1 gap-4">
              <label className="grid gap-1">
                <span className="text-sm text-neutral-600 dark:text-neutral-400">My total savings</span>
                <input
                  inputMode="decimal"
                  className="w-full rounded-md border border-neutral-300 dark:border-neutral-700 bg-transparent px-3 py-2 outline-none focus:ring-2 focus:ring-blue-500"
                  value={state.myTotalSavings}
                  onChange={(e) => upsertNumber("myTotalSavings", parseNumber(e.target.value))}
                  placeholder="0"
                />
              </label>
              <label className="grid gap-1">
                <span className="text-sm text-neutral-600 dark:text-neutral-400">Spouse total savings</span>
                <input
                  inputMode="decimal"
                  className="w-full rounded-md border border-neutral-300 dark:border-neutral-700 bg-transparent px-3 py-2 outline-none focus:ring-2 focus:ring-blue-500"
                  value={state.spouseTotalSavings}
                  onChange={(e) => upsertNumber("spouseTotalSavings", parseNumber(e.target.value))}
                  placeholder="0"
                />
              </label>
            </div>
            <div className="mt-4 text-sm text-neutral-700 dark:text-neutral-300">
              Combined total savings: <span className="font-medium">{formatCurrency(combinedTotalSavings)}</span>
            </div>
            <div className="mt-2 text-sm text-neutral-700 dark:text-neutral-300">
              Assets (current holdings): <span className="font-medium">{formatCurrency(state.savingsHoldings.reduce((s, h) => s + h.amount, 0))}</span>
            </div>
            <div className="mt-4">
              <button onClick={exportToExcel} className="btn-primary">Export to Excel</button>
            </div>
          </div>
        </section>

        <section className="rounded-lg border border-neutral-200 dark:border-neutral-800 p-4 card mb-8">
          <h2 className="text-lg font-medium mb-4">Current Savings by Type</h2>
          <SavingsHoldingForm onSubmit={addOrUpdateHolding} />
          <SavingsHoldingList holdings={state.savingsHoldings} onRemove={removeHolding} onEdit={addOrUpdateHolding} />
          <div className="mt-4 text-sm text-neutral-700 dark:text-neutral-300">
            Total current holdings: {formatCurrency(state.savingsHoldings.reduce((s, h) => s + h.amount, 0))}
          </div>
        </section>

        <section className="rounded-lg border border-neutral-200 dark:border-neutral-800 p-4 card mb-8">
          <h2 className="text-lg font-medium mb-4">Monthly Savings and Expenses</h2>
          <MonthlyEntryForm onSubmit={addOrUpdateEntry} />
          <MonthlyEntryList entries={state.entries} onRemove={removeEntry} onEdit={addOrUpdateEntry} />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-6">
            <div className="rounded-md border border-blue-100 bg-blue-50 p-3">
              <h3 className="text-sm font-medium mb-2">Expenses by category</h3>
              <ExpensesPie entries={state.entries} />
            </div>
            <div className="rounded-md border border-blue-100 bg-blue-50 p-3">
              <h3 className="text-sm font-medium mb-2">Savings by holding type</h3>
              <HoldingsPie holdings={state.savingsHoldings} />
            </div>
          </div>
        </section>

        <section className="rounded-lg border border-neutral-200 dark:border-neutral-800 p-4 card mb-8">
          <h2 className="text-lg font-medium mb-4">Insurance</h2>
          <InsuranceForm onSubmit={addOrUpdateInsurance} />
          <InsuranceList items={state.insurances} onRemove={removeInsurance} onEdit={addOrUpdateInsurance} />
        </section>

        <section className="rounded-lg border border-neutral-200 dark:border-neutral-800 p-4 card">
          <h2 className="text-lg font-medium mb-4">Future Savings Projection</h2>
          <div className="flex items-center gap-3 mb-4">
            <label className="text-sm text-neutral-600 dark:text-neutral-400">Months</label>
            <input
              type="number"
              min={1}
              max={360}
              className="w-24 rounded-md border border-neutral-300 dark:border-neutral-700 bg-transparent px-3 py-2 outline-none focus:ring-2 focus:ring-blue-500"
              value={projectionMonths}
              onChange={(e) => setProjectionMonths(Math.max(1, Math.min(360, Number(e.target.value) || 1)))}
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
            <div className="rounded-md border border-neutral-200 dark:border-neutral-800 p-3">
              <div className="text-neutral-500">Planned monthly savings</div>
              <div className="text-lg font-semibold">{formatCurrency(totalPlannedMonthlySavings)}</div>
            </div>
            <div className="rounded-md border border-neutral-200 dark:border-neutral-800 p-3">
              <div className="text-neutral-500">Projected savings (current + savings × months)</div>
              <div className="text-lg font-semibold">{formatCurrency(projectedSavingsOnly)}</div>
            </div>
          </div>

          <ProjectionByType
            months={projectionMonths}
            currentHoldings={state.savingsHoldings}
            monthlyEntries={state.entries}
          />
          <div className="mt-6 rounded-md border border-blue-100 bg-blue-50 p-3">
            <h3 className="text-sm font-medium mb-2">Projection over time</h3>
            <ProjectionLineChart
              months={projectionMonths}
              starting={combinedTotalSavings}
              monthlySavings={totalPlannedMonthlySavings}
            />
        </div>
        </section>
      </main>
    </div>
  );
}

function ExpensesPie({ entries }: { entries: MonthlyEntry[] }) {
  const data = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of entries) {
      if (e.expenses > 0) {
        const key = e.expenseType ?? "Misc";
        map.set(key, (map.get(key) ?? 0) + e.expenses);
      }
    }
    const labels = Array.from(map.keys());
    const values = Array.from(map.values());
    return {
      labels,
      datasets: [
        {
          data: values,
          backgroundColor: [
            "#60a5fa",
            "#f59e0b",
            "#34d399",
            "#f472b6",
            "#a78bfa",
            "#f87171",
            "#22d3ee",
            "#fbbf24",
            "#93c5fd",
          ],
        },
      ],
    };
  }, [entries]);

  if (!data.labels.length) return <div className="text-sm text-neutral-500">No expenses yet</div>;
  return <Pie data={data} />;
}

function HoldingsPie({ holdings }: { holdings: SavingsHolding[] }) {
  const data = useMemo(() => {
    const map = new Map<string, number>();
    for (const h of holdings) map.set(h.type, (map.get(h.type) ?? 0) + h.amount);
    const labels = Array.from(map.keys());
    const values = Array.from(map.values());
    return {
      labels,
      datasets: [
        {
          data: values,
          backgroundColor: [
            "#34d399",
            "#60a5fa",
            "#f472b6",
            "#a78bfa",
            "#f87171",
            "#22d3ee",
            "#fbbf24",
            "#93c5fd",
          ],
        },
      ],
    };
  }, [holdings]);

  if (!data.labels.length) return <div className="text-sm text-neutral-500">No holdings yet</div>;
  return <Pie data={data} />;
}

function ProjectionLineChart({
  months,
  starting,
  monthlySavings,
}: {
  months: number;
  starting: number;
  monthlySavings: number;
}) {
  const chart = useMemo(() => {
    const labels: string[] = [];
    const savingsPoints: number[] = [];
    const s = starting;
    for (let i = 0; i <= months; i++) {
      labels.push(`${i}`);
      savingsPoints.push(s + i * monthlySavings);
    }
    return {
      labels,
      datasets: [
        {
          label: "Savings only",
          data: savingsPoints,
          borderColor: "#60a5fa",
          backgroundColor: "#60a5fa",
          fill: false,
        },
      ],
    };
  }, [months, starting, monthlySavings]);

  return <Line data={chart} />;
}

function MonthlyEntryForm({
  onSubmit,
  initial,
}: {
  onSubmit: (entry: Partial<MonthlyEntry>) => void;
  initial?: MonthlyEntry;
}) {
  const [month, setMonth] = useState<string>(initial?.month ?? new Date().toISOString().slice(0, 7));
  const [savings, setSavings] = useState<string>(initial ? String(initial.savings) : "");
  const [savingsType, setSavingsType] = useState<string>(initial?.savingsType ?? "MF");
  const [expenses, setExpenses] = useState<string>(initial ? String(initial.expenses) : "");
  const [expenseType, setExpenseType] = useState<string>(initial?.expenseType ?? "Misc");
  const [comment, setComment] = useState<string>(initial?.comment ?? "");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    onSubmit({ id: initial?.id, month, savings: parseNumber(savings), expenses: parseNumber(expenses), savingsType, expenseType, comment });
    if (!initial) {
      setSavings("");
      setExpenses("");
      setComment("");
    }
  }

  return (
    <form onSubmit={handleSubmit} className="grid grid-cols-1 sm:grid-cols-8 gap-3 mb-4">
      <label className="grid gap-1 sm:col-span-2">
        <span className="text-sm text-neutral-600 dark:text-neutral-400">Month</span>
        <input
          type="month"
          className="w-full rounded-md border border-neutral-300 dark:border-neutral-700 bg-transparent px-3 py-2 outline-none focus:ring-2 focus:ring-blue-500"
          value={month}
          onChange={(e) => setMonth(e.target.value)}
          required
        />
      </label>
      <label className="grid gap-1">
        <span className="text-sm text-neutral-600 dark:text-neutral-400">Savings</span>
        <input
          inputMode="decimal"
          className="w-full rounded-md border border-neutral-300 dark:border-neutral-700 bg-transparent px-3 py-2 outline-none focus:ring-2 focus:ring-blue-500"
          value={savings}
          onChange={(e) => setSavings(e.target.value)}
          placeholder="0"
        />
      </label>
      <label className="grid gap-1">
        <span className="text-sm text-neutral-600 dark:text-neutral-400">Savings type</span>
        <select
          className="w-full rounded-md border border-neutral-300 dark:border-neutral-700 bg-transparent px-3 py-2 outline-none focus:ring-2 focus:ring-blue-500"
          value={savingsType}
          onChange={(e) => setSavingsType(e.target.value)}
        >
          {SAVINGS_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </label>
      <label className="grid gap-1">
        <span className="text-sm text-neutral-600 dark:text-neutral-400">Expenses</span>
        <input
          inputMode="decimal"
          className="w-full rounded-md border border-neutral-300 dark:border-neutral-700 bg-transparent px-3 py-2 outline-none focus:ring-2 focus:ring-blue-500"
          value={expenses}
          onChange={(e) => setExpenses(e.target.value)}
          placeholder="0"
        />
      </label>
      <label className="grid gap-1">
        <span className="text-sm text-neutral-600 dark:text-neutral-400">Expense type</span>
        <select
          className="w-full rounded-md border border-neutral-300 dark:border-neutral-700 bg-transparent px-3 py-2 outline-none focus:ring-2 focus:ring-blue-500"
          value={expenseType}
          onChange={(e) => setExpenseType(e.target.value)}
        >
          {EXPENSE_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </label>
      <label className="grid gap-1 sm:col-span-2">
        <span className="text-sm text-neutral-600 dark:text-neutral-400">Comment</span>
        <input
          className="w-full rounded-md border border-neutral-300 dark:border-neutral-700 bg-transparent px-3 py-2 outline-none focus:ring-2 focus:ring-blue-500"
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder="Optional notes"
        />
      </label>
      <div className="flex items-end">
        <button type="submit" className="w-full rounded-md bg-blue-600 hover:bg-blue-700 text-white px-4 py-2">
          {initial ? "Update" : "Add"}
        </button>
      </div>
    </form>
  );
}

function InsuranceForm({ onSubmit, initial }: { onSubmit: (i: Partial<InsuranceItem>) => void; initial?: InsuranceItem }) {
  const [type, setType] = useState<InsuranceType>(initial?.type ?? "Company Health");
  const [coveredPeople, setCoveredPeople] = useState<string>(initial?.coveredPeople ?? "");
  const [limit, setLimit] = useState<string>(initial ? String(initial.limit) : "");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    onSubmit({ id: initial?.id, type, coveredPeople, limit: parseNumber(limit) });
    if (!initial) {
      setCoveredPeople("");
      setLimit("");
    }
  }

  return (
    <form onSubmit={handleSubmit} className="grid grid-cols-1 sm:grid-cols-5 gap-3 mb-4">
      <label className="grid gap-1">
        <span className="text-sm text-neutral-600 dark:text-neutral-400">Type</span>
        <select
          className="w-full rounded-md border border-neutral-300 dark:border-neutral-700 bg-transparent px-3 py-2 outline-none focus:ring-2 focus:ring-blue-500"
          value={type}
          onChange={(e) => setType(e.target.value as InsuranceType)}
        >
          {(["Company Health", "Term", "Personal Health", "Parents Health"] as InsuranceType[]).map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
      </label>
      <label className="grid gap-1 sm:col-span-2">
        <span className="text-sm text-neutral-600 dark:text-neutral-400">Covered people</span>
        <input
          className="w-full rounded-md border border-neutral-300 dark:border-neutral-700 bg-transparent px-3 py-2 outline-none focus:ring-2 focus:ring-blue-500"
          value={coveredPeople}
          onChange={(e) => setCoveredPeople(e.target.value)}
          placeholder="e.g., Self, Spouse, 2 Children"
        />
      </label>
      <label className="grid gap-1">
        <span className="text-sm text-neutral-600 dark:text-neutral-400">Insurance limit</span>
        <input
          inputMode="decimal"
          className="w-full rounded-md border border-neutral-300 dark:border-neutral-700 bg-transparent px-3 py-2 outline-none focus:ring-2 focus:ring-blue-500"
          value={limit}
          onChange={(e) => setLimit(e.target.value)}
          placeholder="0"
        />
      </label>
      <div className="flex items-end">
        <button type="submit" className="w-full rounded-md bg-blue-600 hover:bg-blue-700 text-white px-4 py-2">
          {initial ? "Update" : "Add"}
        </button>
      </div>
    </form>
  );
}

function InsuranceList({ items, onRemove, onEdit }: { items: InsuranceItem[]; onRemove: (id: string) => void; onEdit: (i: Partial<InsuranceItem>) => void; }) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const editing = items.find((i) => i.id === editingId) ?? null;

  return (
    <div className="grid gap-3">
      {editing ? (
        <div className="rounded-md border border-amber-300/40 bg-amber-50/40 dark:border-amber-400/20 dark:bg-amber-500/5 p-3">
          <div className="text-sm font-medium mb-2">Editing insurance</div>
          <InsuranceForm
            initial={editing}
            onSubmit={(i) => {
              onEdit(i);
              setEditingId(null);
            }}
          />
          <button
            className="text-sm text-neutral-600 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200"
            onClick={() => setEditingId(null)}
          >
            Cancel
          </button>
        </div>
      ) : null}

      <div className="overflow-x-auto">
        <table className="w-full text-sm border border-neutral-200 dark:border-neutral-800 rounded-md overflow-hidden">
          <thead className="bg-neutral-50 dark:bg-neutral-900">
            <tr className="text-left">
              <th className="p-2">Type</th>
              <th className="p-2">Covered people</th>
              <th className="p-2">Limit</th>
              <th className="p-2" />
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr>
                <td className="p-3 text-center text-neutral-500" colSpan={4}>
                  No insurance added
                </td>
              </tr>
            ) : (
              items.map((i) => (
                <tr key={i.id} className="border-t border-neutral-200 dark:border-neutral-800">
                  <td className="p-2">{i.type}</td>
                  <td className="p-2">{i.coveredPeople}</td>
                  <td className="p-2">{formatCurrency(i.limit)}</td>
                  <td className="p-2 text-right">
                    <div className="inline-flex gap-2">
                      <button
                        className="rounded border border-neutral-300 dark:border-neutral-700 px-2 py-1 hover:bg-neutral-50 dark:hover:bg-neutral-900"
                        onClick={() => setEditingId(i.id)}
                      >
                        Edit
                      </button>
                      <button
                        className="rounded border border-red-300 text-red-600 px-2 py-1 hover:bg-red-50 dark:border-red-800 dark:hover:bg-red-900/20"
                        onClick={() => onRemove(i.id)}
                      >
                        Remove
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function MonthlyEntryList({
  entries,
  onRemove,
  onEdit,
}: {
  entries: MonthlyEntry[];
  onRemove: (id: string) => void;
  onEdit: (entry: Partial<MonthlyEntry>) => void;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const editing = entries.find((e) => e.id === editingId) ?? null;

  return (
    <div className="grid gap-3">
      {editing ? (
        <div className="rounded-md border border-amber-300/40 bg-amber-50/40 dark:border-amber-400/20 dark:bg-amber-500/5 p-3">
          <div className="text-sm font-medium mb-2">Editing {editing.month}</div>
          <MonthlyEntryForm
            initial={editing}
            onSubmit={(e) => {
              onEdit(e);
              setEditingId(null);
            }}
          />
          <button
            className="text-sm text-neutral-600 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200"
            onClick={() => setEditingId(null)}
          >
            Cancel
          </button>
        </div>
      ) : null}

      <div className="overflow-x-auto">
        <table className="w-full text-sm border border-neutral-200 dark:border-neutral-800 rounded-md overflow-hidden">
          <thead className="bg-neutral-50 dark:bg-neutral-900">
            <tr className="text-left">
              <th className="p-2">Month</th>
              <th className="p-2">Savings</th>
              <th className="p-2">Savings type</th>
              <th className="p-2">Expenses</th>
              <th className="p-2">Expense type</th>
              <th className="p-2">Net</th>
              <th className="p-2">Comment</th>
              <th className="p-2" />
            </tr>
          </thead>
          <tbody>
            {entries.length === 0 ? (
              <tr>
                <td className="p-3 text-center text-neutral-500" colSpan={5}>
                  No entries yet
                </td>
              </tr>
            ) : (
              entries
                .slice()
                .sort((a, b) => b.month.localeCompare(a.month))
                .map((e) => (
                  <tr key={e.id} className="border-t border-neutral-200 dark:border-neutral-800">
                    <td className="p-2 whitespace-nowrap">{e.month}</td>
                    <td className="p-2">{formatCurrency(e.savings)}</td>
                    <td className="p-2">{e.savingsType ?? "-"}</td>
                    <td className="p-2">{formatCurrency(e.expenses)}</td>
                    <td className="p-2">{e.expenseType ?? "-"}</td>
                    <td className="p-2">{formatCurrency(e.savings - e.expenses)}</td>
                    <td className="p-2 max-w-[240px] truncate" title={e.comment}>{e.comment ?? ""}</td>
                    <td className="p-2 text-right">
                      <div className="inline-flex gap-2">
                        <button
                          className="rounded border border-neutral-300 dark:border-neutral-700 px-2 py-1 hover:bg-neutral-50 dark:hover:bg-neutral-900"
                          onClick={() => setEditingId(e.id)}
                        >
                          Edit
                        </button>
                        <button
                          className="rounded border border-red-300 text-red-600 px-2 py-1 hover:bg-red-50 dark:border-red-800 dark:hover:bg-red-900/20"
                          onClick={() => onRemove(e.id)}
                        >
                          Remove
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SavingsHoldingForm({
  onSubmit,
  initial,
}: {
  onSubmit: (holding: Partial<SavingsHolding>) => void;
  initial?: SavingsHolding;
}) {
  const [type, setType] = useState<string>(initial?.type ?? "MF");
  const [amount, setAmount] = useState<string>(initial ? String(initial.amount) : "");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    onSubmit({ id: initial?.id, type, amount: parseNumber(amount) });
    if (!initial) setAmount("");
  }

  return (
    <form onSubmit={handleSubmit} className="grid grid-cols-1 sm:grid-cols-4 gap-3 mb-4">
      <label className="grid gap-1">
        <span className="text-sm text-neutral-600 dark:text-neutral-400">Type</span>
        <select
          className="w-full rounded-md border border-neutral-300 dark:border-neutral-700 bg-transparent px-3 py-2 outline-none focus:ring-2 focus:ring-blue-500"
          value={type}
          onChange={(e) => setType(e.target.value)}
        >
          {SAVINGS_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </label>
      <label className="grid gap-1">
        <span className="text-sm text-neutral-600 dark:text-neutral-400">Amount</span>
        <input
          inputMode="decimal"
          className="w-full rounded-md border border-neutral-300 dark:border-neutral-700 bg-transparent px-3 py-2 outline-none focus:ring-2 focus:ring-blue-500"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="0"
        />
      </label>
      <div className="flex items-end">
        <button type="submit" className="w-full rounded-md bg-blue-600 hover:bg-blue-700 text-white px-4 py-2">
          {initial ? "Update" : "Add"}
        </button>
      </div>
    </form>
  );
}

function SavingsHoldingList({
  holdings,
  onRemove,
  onEdit,
}: {
  holdings: SavingsHolding[];
  onRemove: (id: string) => void;
  onEdit: (h: Partial<SavingsHolding>) => void;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const editing = holdings.find((h) => h.id === editingId) ?? null;

  const byType = useMemo(() => {
    const map = new Map<string, number>();
    for (const h of holdings) {
      map.set(h.type, (map.get(h.type) ?? 0) + h.amount);
    }
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
  }, [holdings]);

  return (
    <div className="grid gap-3">
      {editing ? (
        <div className="rounded-md border border-amber-300/40 bg-amber-50/40 dark:border-amber-400/20 dark:bg-amber-500/5 p-3">
          <div className="text-sm font-medium mb-2">Editing holding</div>
          <SavingsHoldingForm
            initial={editing}
            onSubmit={(h) => {
              onEdit(h);
              setEditingId(null);
            }}
          />
          <button
            className="text-sm text-neutral-600 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200"
            onClick={() => setEditingId(null)}
          >
            Cancel
          </button>
        </div>
      ) : null}

      <div className="overflow-x-auto">
        <table className="w-full text-sm border border-neutral-200 dark:border-neutral-800 rounded-md overflow-hidden mb-3">
          <thead className="bg-neutral-50 dark:bg-neutral-900">
            <tr className="text-left">
              <th className="p-2">Type</th>
              <th className="p-2">Amount</th>
              <th className="p-2" />
            </tr>
          </thead>
          <tbody>
            {holdings.length === 0 ? (
              <tr>
                <td className="p-3 text-center text-neutral-500" colSpan={3}>
                  No holdings yet
                </td>
              </tr>
            ) : (
              holdings.map((h) => (
                <tr key={h.id} className="border-top border-neutral-200 dark:border-neutral-800">
                  <td className="p-2">{h.type}</td>
                  <td className="p-2">{formatCurrency(h.amount)}</td>
                  <td className="p-2 text-right">
                    <div className="inline-flex gap-2">
                      <button
                        className="rounded border border-neutral-300 dark:border-neutral-700 px-2 py-1 hover:bg-neutral-50 dark:hover:bg-neutral-900"
                        onClick={() => setEditingId(h.id)}
                      >
                        Edit
                      </button>
                      <button
                        className="rounded border border-red-300 text-red-600 px-2 py-1 hover:bg-red-50 dark:border-red-800 dark:hover:bg-red-900/20"
                        onClick={() => onRemove(h.id)}
                      >
                        Remove
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {byType.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
          {byType.map(([type, amount]) => (
            <div key={type} className="rounded-md border border-neutral-200 dark:border-neutral-800 p-3">
              <div className="text-neutral-500 text-xs">{type}</div>
              <div className="text-base font-semibold">{formatCurrency(amount)}</div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ProjectionByType({
  months,
  currentHoldings,
  monthlyEntries,
}: {
  months: number;
  currentHoldings: SavingsHolding[];
  monthlyEntries: MonthlyEntry[];
}) {
  const currentByType = useMemo(() => {
    const map = new Map<string, number>();
    for (const h of currentHoldings) map.set(h.type, (map.get(h.type) ?? 0) + h.amount);
    return map;
  }, [currentHoldings]);

  const monthlySavingsByType = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of monthlyEntries) {
      if (e.savings > 0) {
        const key = e.savingsType ?? "Unspecified";
        map.set(key, (map.get(key) ?? 0) + e.savings);
      }
    }
    return map;
  }, [monthlyEntries]);

  const rows = useMemo(() => {
    const types = new Set<string>([
      ...Array.from(currentByType.keys()),
      ...Array.from(monthlySavingsByType.keys()),
    ]);
    return Array.from(types).map((t) => {
      const current = currentByType.get(t) ?? 0;
      const monthly = monthlySavingsByType.get(t) ?? 0;
      const projected = current + months * monthly;
      return { type: t, current, monthly, projected };
    }).sort((a, b) => (b.projected - a.projected));
  }, [currentByType, monthlySavingsByType, months]);

  if (rows.length === 0) return null;

  return (
    <div className="mt-6">
      <h3 className="text-base font-medium mb-2">Projection by savings type</h3>
      <div className="overflow-x-auto">
        <table className="w-full text-sm border border-neutral-200 dark:border-neutral-800 rounded-md overflow-hidden">
          <thead className="bg-neutral-50 dark:bg-neutral-900">
            <tr className="text-left">
              <th className="p-2">Type</th>
              <th className="p-2">Current</th>
              <th className="p-2">Monthly add</th>
              <th className="p-2">Projected</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.type} className="border-t border-neutral-200 dark:border-neutral-800">
                <td className="p-2">{r.type}</td>
                <td className="p-2">{formatCurrency(r.current)}</td>
                <td className="p-2">{formatCurrency(r.monthly)}</td>
                <td className="p-2 font-medium">{formatCurrency(r.projected)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
