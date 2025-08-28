// src/components/Header.tsx

export default function Header() {
  return (
    <header className="w-full bg-white shadow-md p-4 flex justify-between items-center">
      <h1 className="text-xl font-bold text-gray-800">My App</h1>
      <nav className="space-x-4">
        <a href="/" className="text-gray-600 hover:text-gray-900">Home</a>
        <a href="/about" className="text-gray-600 hover:text-gray-900">About</a>
        <a href="/contact" className="text-gray-600 hover:text-gray-900">Contact</a>
      </nav>
    </header>
  );
}
