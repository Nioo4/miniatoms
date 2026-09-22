import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getSession: vi.fn(), getUser: vi.fn(), signInAnonymously: vi.fn(), refreshSession: vi.fn(), updateUser: vi.fn(), verifyOtp: vi.fn(), signInWithPassword: vi.fn(), signOut: vi.fn(), createClient: vi.fn() }));
vi.mock("@supabase/supabase-js", () => ({ createClient: mocks.createClient }));
beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://localhost:54321");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "public-test-key");
  vi.stubEnv("NEXT_PUBLIC_ENABLE_EMAIL_AUTH", "false");
  mocks.createClient.mockReturnValue({ auth: mocks });
});
describe("anonymous session initialization", () => {
  it("shares one promise and creates only one anonymous user", async () => {
    mocks.getSession.mockResolvedValue({ data: { session: null }, error: null });
    mocks.signInAnonymously.mockResolvedValue({ data: { session: { user: { id: "visitor" }, access_token: "test" } }, error: null });
    const { initializeSession } = await import("../../src/lib/client/auth");
    const first = initializeSession();
    expect(initializeSession()).toBe(first);
    await first;
    expect(mocks.createClient).toHaveBeenCalledTimes(1);
    expect(mocks.signInAnonymously).toHaveBeenCalledTimes(1);
  });
  it("does not create a new identity after an existing-session network error", async () => {
    mocks.getSession.mockResolvedValue({ data: { session: null }, error: new Error("network") });
    const { initializeSession } = await import("../../src/lib/client/auth");
    await expect(initializeSession()).rejects.toThrow("原有访客会话");
    expect(mocks.signInAnonymously).not.toHaveBeenCalled();
  });
  it("refreshes an expired session without falling back to anonymous signup", async () => {
    mocks.getSession.mockResolvedValue({ data: { session: { expires_at: 1 } }, error: null });
    mocks.refreshSession.mockResolvedValue({ data: { session: null }, error: new Error("unavailable") });
    const { initializeSession } = await import("../../src/lib/client/auth");
    await expect(initializeSession()).rejects.toThrow("原身份");
    expect(mocks.refreshSession).toHaveBeenCalledTimes(1);
    expect(mocks.signInAnonymously).not.toHaveBeenCalled();
  });
});

describe("optional email recovery", () => {
  const anonymous = { id: "visitor", is_anonymous: true, email: undefined, new_email: "owner@example.com", email_confirmed_at: undefined, user_metadata: {} };

  it("starts with updateUser and keeps the anonymous user id", async () => {
    vi.stubEnv("NEXT_PUBLIC_ENABLE_EMAIL_AUTH", "true");
    mocks.getUser.mockResolvedValue({ data: { user: anonymous }, error: null });
    mocks.updateUser.mockResolvedValue({ data: { user: { ...anonymous, user_metadata: { miniatoms_email_recovery_status: "email_pending" } } }, error: null });
    const { linkEmail } = await import("../../src/lib/client/auth");
    const result = await linkEmail("owner@example.com");
    expect(result.id).toBe("visitor");
    expect(mocks.updateUser).toHaveBeenCalledWith(expect.objectContaining({ email: "owner@example.com", data: expect.objectContaining({ miniatoms_email_recovery_status: "email_pending" }) }));
  });

  it("rejects an OTP response that switches the current user", async () => {
    vi.stubEnv("NEXT_PUBLIC_ENABLE_EMAIL_AUTH", "true");
    mocks.getUser.mockResolvedValue({ data: { user: anonymous }, error: null });
    mocks.verifyOtp.mockResolvedValue({ data: { user: { ...anonymous, id: "other", is_anonymous: false, email_confirmed_at: "now", new_email: undefined } }, error: null });
    const { verifyEmailOtp } = await import("../../src/lib/client/auth");
    await expect(verifyEmailOtp("owner@example.com", "123456")).rejects.toThrow("切换了用户身份");
    expect(mocks.updateUser).not.toHaveBeenCalled();
  });

  it("does not set a password from an unconfirmed or anonymous metadata marker", async () => {
    vi.stubEnv("NEXT_PUBLIC_ENABLE_EMAIL_AUTH", "true");
    mocks.getUser.mockResolvedValue({ data: { user: { ...anonymous, new_email: undefined, email_confirmed_at: "now", user_metadata: { miniatoms_email_recovery_status: "password_pending" } } }, error: null });
    const { setRecoveryPassword } = await import("../../src/lib/client/auth");
    await expect(setRecoveryPassword("correct horse battery staple")).rejects.toThrow("完成邮箱验证码验证");
    expect(mocks.updateUser).not.toHaveBeenCalled();
  });

  it("derives password-pending after confirmation when the metadata write was lost", async () => {
    vi.stubEnv("NEXT_PUBLIC_ENABLE_EMAIL_AUTH", "true");
    const { authIdentity } = await import("../../src/lib/client/auth");
    const identity = authIdentity({ user: { ...anonymous, is_anonymous: false, new_email: undefined, email_confirmed_at: "now", user_metadata: { miniatoms_email_recovery_status: "email_pending" } }, access_token: "test" } as never);
    expect(identity?.recoveryStatus).toBe("password_pending");
  });
});
