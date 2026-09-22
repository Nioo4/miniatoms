"use client";

import { useState, type FormEvent } from "react";
import type { AuthIdentity } from "@/lib/client/auth";

type Phase = "email" | "otp" | "password" | "login" | "done";

type AccountPanelProps = {
  account: AuthIdentity | null;
  projectCount: number;
  allowExistingLogin: boolean;
  canChange: boolean;
  busy: boolean;
  onLinkEmail: (email: string) => Promise<void>;
  onVerifyEmail: (email: string, token: string) => Promise<void>;
  onSetPassword: (password: string) => Promise<void>;
  onSignIn: (email: string, password: string) => Promise<void>;
  onSignOut: () => Promise<void>;
};

export function AccountPanel({ account, projectCount, allowExistingLogin, canChange, busy, onLinkEmail, onVerifyEmail, onSetPassword, onSignIn, onSignOut }: AccountPanelProps) {
  const [phase, setPhase] = useState<Phase>("email");
  const [email, setEmail] = useState("");
  const [token, setToken] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  if (!account) return <div className="sidebar-bottom"><span className="avatar">访</span><div>正在准备账号<small>正在读取身份状态</small></div></div>;

  const serverPhase: Phase | null = account.recoveryStatus === "email_pending" ? "otp" : account.recoveryStatus === "password_pending" ? "password" : account.recoveryStatus === "ready" ? "done" : null;
  const visiblePhase = phase === "done" ? "done" : serverPhase ?? phase;
  const recoveryEmail = email || account.pendingEmail || "";
  const pendingRecovery = account.recoveryStatus === "email_pending" || account.recoveryStatus === "password_pending";
  const permanent = !account.isAnonymous && !pendingRecovery;
  const blocked = busy || !canChange;

  async function submit(event: FormEvent, action: () => Promise<void>, success: string) {
    event.preventDefault(); setError(""); setNotice("");
    try { await action(); setNotice(success); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "操作失败，请稍后重试。"); }
  }

  if (permanent) {
    return <section className="account-panel" aria-label="账号">
      <div className="account-heading"><span className="avatar">邮</span><div><strong>{account.email ?? "已登录账号"}</strong><small>项目使用永久账号</small></div></div>
      {error && <p className="error-text" role="alert">{error}</p>}
      {notice && <p className="notice">{notice}</p>}
      <button className="text-button" disabled={blocked} onClick={() => void submit({ preventDefault() {} } as FormEvent, onSignOut, "已退出当前账号")}>退出当前账号</button>
      {!canChange && <small className="account-hint">生成或保存进行中，完成后才能退出。</small>}
    </section>;
  }

  if (visiblePhase === "done" || account.recoveryStatus === "ready") {
    return <section className="account-panel" aria-label="账号">
      <div className="account-heading"><span className="avatar">邮</span><div><strong>{account.email ?? "邮箱账号"}</strong><small>邮箱和密码已设置，可跨浏览器恢复</small></div></div>
      <p className="notice">当前项目仍属于原来的用户身份。</p>
      {error && <p className="error-text" role="alert">{error}</p>}
      <button className="text-button" disabled={blocked} onClick={() => void submit({ preventDefault() {} } as FormEvent, onSignOut, "已退出当前账号")}>退出当前账号</button>
    </section>;
  }

  if (visiblePhase === "password") {
    return <section className="account-panel" aria-label="完成邮箱保护">
      <div className="account-heading"><span className="avatar">锁</span><div><strong>{recoveryEmail || account.email || "邮箱已确认"}</strong><small>邮箱已确认，还需设置密码</small></div></div>
      <form onSubmit={event => void submit(event, async () => {
        if (password.length < 8) throw new Error("密码至少需要 8 个字符。");
        if (password !== confirmPassword) throw new Error("两次输入的密码不一致。");
        await onSetPassword(password);
        setPhase("done"); setPassword(""); setConfirmPassword("");
      }, "邮箱和密码已设置，可跨浏览器恢复。") }>
        <label>设置密码<input type="password" minLength={8} autoComplete="new-password" value={password} onChange={event => setPassword(event.target.value)} disabled={blocked} required /></label>
        <label>再次输入<input type="password" minLength={8} autoComplete="new-password" value={confirmPassword} onChange={event => setConfirmPassword(event.target.value)} disabled={blocked} required /></label>
        <button className="primary" type="submit" disabled={blocked}>保存密码</button>
      </form>
      {error && <p className="error-text" role="alert">{error}</p>}
      {notice && <p className="notice">{notice}</p>}
    </section>;
  }

  if (visiblePhase === "otp") {
    return <section className="account-panel" aria-label="确认邮箱">
      <div className="account-heading"><span className="avatar">验</span><div><strong>确认 {recoveryEmail || "邮箱"}</strong><small>尚未完成绑定</small></div></div>
      <p className="account-hint">请输入邮件中的 6 位验证码。此入口不处理只有链接的邮件模板。</p>
      <form onSubmit={event => void submit(event, async () => {
        if (!/^\d{6}$/.test(token)) throw new Error("请输入 6 位数字验证码。");
        await onVerifyEmail(recoveryEmail, token);
        setPhase("password"); setToken("");
      }, "邮箱已确认，还需设置密码才能完成找回。") }>
        <label>邮件验证码<input inputMode="numeric" pattern="[0-9]{6}" maxLength={6} autoComplete="one-time-code" value={token} onChange={event => setToken(event.target.value.replace(/\D/g, "").slice(0, 6))} disabled={blocked} required /></label>
        <button className="primary" type="submit" disabled={blocked}>确认邮箱</button>
      </form>
      {error && <p className="error-text" role="alert">{error}</p>}
      {notice && <p className="notice">{notice}</p>}
    </section>;
  }

  if (visiblePhase === "login") {
    const hasProjects = projectCount > 0;
    return <section className="account-panel" aria-label="登录已有账号">
      <div className="account-heading"><span className="avatar">登</span><div><strong>登录已有账号</strong><small>不会合并当前匿名项目</small></div></div>
      {hasProjects && <p className="account-hint">当前匿名身份已有 {projectCount} 个项目。请先完成邮箱保护；登录已有账号不会自动迁移项目。</p>}
      {allowExistingLogin && !hasProjects && <form onSubmit={event => void submit(event, async () => { await onSignIn(loginEmail, loginPassword); }, "登录成功，正在载入账号") }>
        <label>邮箱<input type="email" autoComplete="username" value={loginEmail} onChange={event => setLoginEmail(event.target.value)} disabled={blocked} required /></label>
        <label>密码<input type="password" autoComplete="current-password" value={loginPassword} onChange={event => setLoginPassword(event.target.value)} disabled={blocked} required /></label>
        <button className="primary" type="submit" disabled={blocked}>登录</button>
      </form>}
      {error && <p className="error-text" role="alert">{error}</p>}
      {notice && <p className="notice">{notice}</p>}
      <button className="text-button" disabled={busy} onClick={() => { setError(""); setNotice(""); setPhase("email"); }}>返回邮箱保护</button>
    </section>;
  }

  return <section className="account-panel" aria-label="保护当前项目">
    <div className="account-heading"><span className="avatar">访</span><div><strong>匿名访客</strong><small>身份仅保存在此浏览器</small></div></div>
    <p className="account-hint">绑定邮箱会保留当前匿名身份和项目；清除浏览器数据前请完成验证和密码设置。</p>
    <form onSubmit={event => void submit(event, async () => { await onLinkEmail(email); setPhase("otp"); }, "确认邮件已发送；尚未完成绑定。") }>
      <label>邮箱<input type="email" autoComplete="email" value={email} onChange={event => setEmail(event.target.value)} disabled={blocked} required /></label>
      <button className="primary" type="submit" disabled={blocked}>绑定邮箱</button>
    </form>
    {projectCount > 0 && <p className="account-hint">当前已有 {projectCount} 个项目，绑定后项目仍归当前身份。</p>}
    {error && <p className="error-text" role="alert">{error}</p>}
    {notice && <p className="notice">{notice}</p>}
    {allowExistingLogin && projectCount === 0 && <button className="text-button" disabled={blocked} onClick={() => { setError(""); setNotice(""); setPhase("login"); }}>登录已有账号</button>}
    {!canChange && <small className="account-hint">生成或保存进行中，暂不能切换账号。</small>}
  </section>;
}
