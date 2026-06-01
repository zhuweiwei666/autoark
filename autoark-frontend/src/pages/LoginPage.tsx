import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowRight,
  LockKey,
  Pulse,
  ShieldCheck,
  User,
} from "@phosphor-icons/react";
import { useAuth } from "../contexts/AuthContext";

const signalRows = [
  { label: "Spend guard", value: "active" },
  { label: "R2 storage", value: "ready" },
  { label: "Gateway", value: "https" },
];

const LoginPage: React.FC = () => {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const { login, isAuthenticated } = useAuth();
  const navigate = useNavigate();

  React.useEffect(() => {
    if (isAuthenticated) {
      navigate("/dashboard");
    }
  }, [isAuthenticated, navigate]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    setIsLoading(true);

    try {
      await login(username, password);
    } catch (err: any) {
      setError(err.message || "登录失败，请检查用户名和密码");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <main className="min-h-[100dvh] bg-[#f5f7f5] text-zinc-950">
      <div className="grid min-h-[100dvh] lg:grid-cols-[minmax(0,1.05fr)_minmax(420px,0.95fr)]">
        <section className="relative flex flex-col justify-between overflow-hidden border-b border-zinc-200 px-6 py-8 lg:border-b-0 lg:border-r lg:px-12 xl:px-16">
          <div className="relative z-10">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-zinc-950 text-white shadow-[0_18px_36px_-26px_rgba(24,24,27,0.9)]">
                <Pulse size={22} weight="fill" />
              </div>
              <div>
                <div className="text-lg font-extrabold">AutoArk</div>
                <div className="text-xs font-semibold text-zinc-500">
                  Ad operations
                </div>
              </div>
            </div>
          </div>

          <div className="relative z-10 my-16 max-w-2xl lg:my-0">
            <div className="mb-5 inline-flex items-center gap-2 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs font-bold text-zinc-700 shadow-[0_16px_30px_-28px_rgba(24,24,27,0.65)]">
              <ShieldCheck size={15} className="text-[#0f766e]" />
              Production console
            </div>
            <h1 className="max-w-xl text-5xl font-extrabold leading-[0.98] text-zinc-950 md:text-6xl">
              投放经营控制台
            </h1>
            <p className="mt-6 max-w-[58ch] text-base leading-7 text-zinc-600">
              AutoArk 把账户、素材、批量发布和 Agent
              操作放在同一个安静的工作台里。登录后直接进入今日经营视图。
            </p>
          </div>

          <div className="relative z-10 grid max-w-2xl gap-3 sm:grid-cols-3">
            {signalRows.map((row) => (
              <div
                key={row.label}
                className="rounded-lg border border-zinc-200 bg-white/82 p-4 shadow-[0_16px_30px_-28px_rgba(24,24,27,0.65)]"
              >
                <div className="text-xs font-semibold text-zinc-500">
                  {row.label}
                </div>
                <div className="mt-2 font-mono text-sm font-bold text-zinc-950">
                  {row.value}
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="flex items-center justify-center px-6 py-10 lg:px-10">
          <div className="w-full max-w-md">
            <div className="mb-8">
              <h2 className="text-2xl font-extrabold text-zinc-950">登录</h2>
              <p className="mt-2 text-sm leading-6 text-zinc-600">
                使用管理员账号进入控制台。
              </p>
            </div>

            <form
              onSubmit={handleSubmit}
              className="space-y-5 rounded-lg border border-zinc-200 bg-white p-5 shadow-[0_22px_55px_-42px_rgba(24,24,27,0.78)]"
            >
              <div className="space-y-2">
                <label
                  htmlFor="username"
                  className="block text-sm font-bold text-zinc-800"
                >
                  用户名
                </label>
                <div className="relative">
                  <User
                    size={18}
                    className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400"
                  />
                  <input
                    id="username"
                    type="text"
                    value={username}
                    onChange={(event) => setUsername(event.target.value)}
                    className="h-12 w-full rounded-lg border border-zinc-300 bg-[#fbfbf8] pl-10 pr-4 text-sm font-semibold text-zinc-950 placeholder:text-zinc-400"
                    placeholder="输入用户名"
                    required
                    autoComplete="username"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label
                  htmlFor="password"
                  className="block text-sm font-bold text-zinc-800"
                >
                  密码
                </label>
                <div className="relative">
                  <LockKey
                    size={18}
                    className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400"
                  />
                  <input
                    id="password"
                    type="password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    className="h-12 w-full rounded-lg border border-zinc-300 bg-[#fbfbf8] pl-10 pr-4 text-sm font-semibold text-zinc-950 placeholder:text-zinc-400"
                    placeholder="输入密码"
                    required
                    autoComplete="current-password"
                  />
                </div>
              </div>
              {error && (
                <div className="rounded-lg border border-[#fecdd3] bg-[#fff1f2] px-4 py-3 text-sm font-semibold text-[#b4233a]">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={isLoading}
                className="group flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-zinc-950 px-4 text-sm font-extrabold text-white shadow-[0_18px_34px_-24px_rgba(24,24,27,0.95)] hover:bg-zinc-800 active:translate-y-px disabled:bg-zinc-400"
              >
                {isLoading ? "登录中" : "进入控制台"}
                <ArrowRight
                  size={18}
                  className="transition-transform group-hover:translate-x-0.5"
                />
              </button>
            </form>
          </div>
        </section>
      </div>
    </main>
  );
};

export default LoginPage;
