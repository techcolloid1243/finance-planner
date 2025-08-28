// src/app/page.tsx

import Header from "../components/Header";

export default function Home() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-start bg-gray-50">
      {/* Global Header */}
      <Header />

      {/* Hero Section */}
      <section className="w-full max-w-4xl px-6 py-16 text-center">
        <h1 className="text-4xl md:text-5xl font-bold text-gray-900">
          Welcome to My Next.js App 🚀
        </h1>
        <p className="mt-6 text-lg text-gray-600">
          This is your landing page. You can now start editing{" "}
          <code className="px-2 py-1 bg-gray-200 rounded">page.tsx</code> to
          build your app.
        </p>
      </section>

      {/* Example Content Section */}
      <section className="w-full max-w-3xl px-6 py-10 grid gap-6 sm:grid-cols-2">
        <div className="p-6 bg-white rounded-2xl shadow">
          <h2 className="text-xl font-semibold">🔥 Fast Refresh</h2>
          <p className="mt-2 text-gray-600">
            Edit your code and see changes instantly. No reload needed.
          </p>
        </div>

        <div className="p-6 bg-white rounded-2xl shadow">
          <h2 className="text-xl font-semibold">🎨 Tailwind Ready</h2>
          <p className="mt-2 text-gray-600">
            Utility-first styling is already included. Build beautiful UI fast.
          </p>
        </div>
      </section>
    </main>
  );
}
