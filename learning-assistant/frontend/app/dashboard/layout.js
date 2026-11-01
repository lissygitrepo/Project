"use client";

import { useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "../../lib/auth";

// We'll add entries here as each page is built
const NAV = {
  student: [
    { href: "/dashboard", label: "Overview" },
    { href: "/dashboard/ask", label: "Ask" },
    { href: "/dashboard/quiz", label: "Quiz" },
    { href: "/dashboard/progress", label: "Progress" },
  ],
  instructor: [
    { href: "/dashboard", label: "Overview" },
    { href: "/dashboard/upload", label: "Upload" },
    { href: "/dashboard/analytics", label: "Analytics" },
  ],
};

export default function DashboardLayout({ children }) {
  const { user, loading, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [loading, user, router]);

  if (loading || !user) {
    return <p className="p-8 text-gray-500">Loading...</p>;
  }

  const links = NAV[user.role] || [];

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-6">
            <span className="font-semibold">AI Learning Assistant</span>
            <nav className="flex gap-1">
              {links.map((l) => (
                <Link
                  key={l.href}
                  href={l.href}
                  className={`rounded-md px-3 py-1.5 text-sm ${
                    pathname === l.href ? "bg-indigo-50 font-medium text-indigo-700" : "text-gray-600 hover:bg-gray-100"
                  }`}
                >
                  {l.label}
                </Link>
              ))}
            </nav>
          </div>

          <div className="flex items-center gap-3 text-sm">
            <span>{user.name}</span>
            <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-medium capitalize text-indigo-700">
              {user.role}
            </span>
            <button
              onClick={() => {
                logout();
                router.replace("/login");
              }}
              className="rounded-md border border-gray-300 px-3 py-1 hover:bg-gray-100"
            >
              Log out
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-8">{children}</main>
    </div>
  );
}