import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { ApiError, api, authApi, getToken, setToken } from "../api.js";

const store = new Map();
globalThis.localStorage = {
  getItem: (key) => (store.has(key) ? store.get(key) : null),
  setItem: (key, value) => store.set(key, String(value)),
  removeItem: (key) => store.delete(key),
  clear: () => store.clear(),
};

let realFetch;

beforeEach(() => {
  store.clear();
  realFetch = globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

function mockFetch(handler) {
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url, options });
    return handler(url, options);
  };
  return calls;
}

describe("api 请求封装", () => {
  it("token 读写与清除", () => {
    assert.strictEqual(getToken(), "");
    setToken("abc");
    assert.strictEqual(getToken(), "abc");
    setToken("");
    assert.strictEqual(getToken(), "");
  });

  it("有 token 时自动带上 Bearer 头", async () => {
    setToken("tkn-1");
    const calls = mockFetch(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ ok: true }),
    }));

    await api("/corrections");

    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0].url, "/api/corrections");
    assert.strictEqual(calls[0].options.headers.Authorization, "Bearer tkn-1");
  });

  it("auth:false 时不带 Authorization（登录/注册）", async () => {
    setToken("tkn-1");
    const calls = mockFetch(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ ok: true }),
    }));

    await api("/auth/login", { method: "POST", body: { username: "u" }, auth: false });

    assert.ok(!("Authorization" in calls[0].options.headers));
    assert.strictEqual(calls[0].options.headers["Content-Type"], "application/json");
    assert.strictEqual(calls[0].options.body, JSON.stringify({ username: "u" }));
  });

  it("后端返回非 2xx 时抛出带状态码的 ApiError", async () => {
    mockFetch(async () => ({
      ok: false,
      status: 403,
      json: async () => ({ message: "只有教师可以校对题目" }),
    }));

    await assert.rejects(
      () => api("/corrections", { method: "PUT", body: {} }),
      (error) => {
        assert.ok(error instanceof ApiError);
        assert.strictEqual(error.status, 403);
        assert.strictEqual(error.message, "只有教师可以校对题目");
        return true;
      },
    );
  });

  it("错误响应不是 JSON 时使用状态码兜底文案", async () => {
    mockFetch(async () => ({
      ok: false,
      status: 502,
      json: async () => {
        throw new Error("not json");
      },
    }));

    await assert.rejects(
      () => api("/any"),
      (error) => error instanceof ApiError && error.status === 502 && /502/.test(error.message),
    );
  });

  it("网络异常转换为 status=0 的 ApiError", async () => {
    globalThis.fetch = async () => {
      throw new TypeError("fetch failed");
    };

    await assert.rejects(
      () => api("/any"),
      (error) => error instanceof ApiError && error.status === 0,
    );
  });

  it("authApi.login 使用 /auth/login 且不携带旧 token", async () => {
    setToken("stale-token");
    const calls = mockFetch(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ token: "new", user: { id: 1 } }),
    }));

    const data = await authApi.login("alice", "Passw0rd!");

    assert.deepStrictEqual(data, { token: "new", user: { id: 1 } });
    assert.strictEqual(calls[0].url, "/api/auth/login");
    assert.ok(!("Authorization" in calls[0].options.headers));
  });
});
