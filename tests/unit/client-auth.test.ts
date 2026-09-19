import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getSession: vi.fn(), signInAnonymously: vi.fn(), refreshSession: vi.fn(), createClient: vi.fn() }));
vi.mock("@supabase/supabase-js", () => ({ createClient: mocks.createClient }));
beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://localhost:54321");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "public-test-key");
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
