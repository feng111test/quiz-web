/**
 * 后端接口客户端。默认走同源 /api（vite 开发服务器与生产部署都配了代理），
 * 需要指向独立部署的服务时用 VITE_API_BASE 覆盖，例如 http://1.2.3.4:8787/api
 */
const TOKEN_KEY = "exam-workspace:auth:token";

export const API_BASE = import.meta.env?.VITE_API_BASE || "/api";

export function getToken() {
  try {
    return localStorage.getItem(TOKEN_KEY) || "";
  } catch {
    return "";
  }
}

export function setToken(token) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* 隐私模式下写不进去也不影响使用，只是刷新后要重新登录 */
  }
}

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

export async function api(path, { method = "GET", body, auth = true } = {}) {
  const headers = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const token = getToken();
  if (auth && token) headers.Authorization = `Bearer ${token}`;

  let response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (error) {
    throw new ApiError("无法连接题库服务，请确认 npm run server 已启动", 0);
  }

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new ApiError(data?.message || `请求失败（${response.status}）`, response.status);
  }
  return data;
}

export const authApi = {
  login: (username, password) => api("/auth/login", { method: "POST", body: { username, password }, auth: false }),
  register: (payload) => api("/auth/register", { method: "POST", body: payload, auth: false }),
  me: () => api("/auth/me"),
};

export const correctionApi = {
  list: (bankId) => api(`/corrections?bankId=${encodeURIComponent(bankId)}`, { auth: false }),
  save: (payload) => api("/corrections", { method: "PUT", body: payload }),
  remove: (bankId, questionId) => api("/corrections", { method: "DELETE", body: { bankId, questionId } }),
};

export const feedbackApi = {
  create: (payload) => api("/feedback", { method: "POST", body: payload }),
  mine: () => api("/feedback/mine"),
  inbox: (status = "open") => api(`/feedback?status=${encodeURIComponent(status)}`),
  resolve: (id, action, note = "") => api(`/feedback/${id}/resolve`, { method: "POST", body: { action, note } }),
};
