# 可选邮箱保护与跨浏览器找回（默认关闭）

此功能已实现，但**尚未通过生产真实邮箱验收**。匿名用户继续保留原体验；清除未绑定的浏览器身份后，仍不能找回项目。

启用前，在 Supabase 的 Auth 配置中开启 Email provider、Allow manual linking 和邮箱确认，配置可投递的 SMTP；保持 OTP 为 6 位，把 **Change email address** 邮件模板改为包含 `{{ .Token }}` 的验证码模板。仅含确认链接的默认模板不适用于本界面。完成后设置 Vercel Production 的 `NEXT_PUBLIC_ENABLE_EMAIL_AUTH=true` 并重新部署。

必须实际验证：匿名创建项目 → 绑定邮箱并收取验证码 → 确认后设置密码 → 检查前后用户 UID 一致 → 在新的浏览器登录并找回原项目。开发时没有发送验证邮件或更改远程 Auth 配置，也没有把 fixture 当作收信与跨浏览器找回成功。

以下为接口与状态边界说明。

MiniAtoms still starts with a Supabase anonymous user. The optional email flow upgrades that same user; it does not create a second user and it never merges two existing users. The project rows therefore keep their original `owner_id`.

The UI is disabled unless the client build contains:

```env
NEXT_PUBLIC_ENABLE_EMAIL_AUTH=true
```

Leave the flag at `false` until the Auth and mail path has been configured and tested with a real mailbox. The default anonymous warning remains the supported behavior while the flag is off.

Before enabling the flag in a deployed environment, configure the Supabase Auth project with:

- Email provider enabled and **Allow manual linking** enabled. `auth.updateUser({ email })` must be allowed to link the email identity to the current anonymous user.
- Email confirmation enabled.
- A working SMTP provider and a reachable `Site URL`. The hosted default email service is rate-limited and is not evidence that a production mailbox can receive this message; local development can use the Supabase Mailpit setup.
- The **Change email address** template must contain the OTP variable `{{ .Token }}` and tell the user to enter that code. The UI calls `verifyOtp({ email, token, type: "email_change" })`; it does not consume the default confirmation-link redirect. A template that only contains `{{ .ConfirmationURL }}` cannot complete this screen.

The sequence is deliberately staged:

1. `updateUser({ email, data })` records only an `email_pending` UI marker and sends the change-email message. The UI says that the request is pending.
2. The user enters the email OTP. The client checks the current user ID and pending email before calling `verifyOtp`, and rejects a response that changes the user ID. The returned server user must be confirmed and no longer anonymous before the flow can proceed.
3. `updateUser({ password, data })` is allowed only when the server user has `email_confirmed_at`, is non-anonymous, and has no pending email change. Only this successful call records the `ready` marker and enables the “recoverable” message.

The metadata marker is display state only. It is never used by the API or RLS as authorization; the Supabase access token and the original user ID remain authoritative. A pending or confirmed-but-no-password state is kept in the Supabase user metadata so a reload can return the user to the OTP or password step. No password is stored in browser storage.

Existing-account login is offered only when the current anonymous identity has no projects. It does not migrate or merge data. Local sign-out is guarded until generation, preview writes, and feedback writes have drained. RLS and server ownership checks are unchanged.

## Verification boundary

Unit and browser fixtures can verify state transitions, same-UID handling, and the no-merge guard. They cannot prove that SMTP delivered a message or that a human received it. A real acceptance run needs a real mailbox and must record: the original and post-OTP `user.id` are equal, the project remains visible, the password can be set after confirmation, and a fresh browser can sign in and read that project. A successful `updateUser` request or a fixture result alone is not a production email-success claim.
