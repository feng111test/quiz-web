/**
 * 登录态：token 存 localStorage，用户信息随请求刷新。
 * 角色只用于界面分支，真正的权限校验在服务端（学生调校对接口会被 403）。
 */
import { ApiError, authApi, getToken, setToken } from "./api.js";

const USER_KEY = "exam-workspace:auth:user";

let session = readSession();
const listeners = new Set();

function readSession() {
  try {
    const raw = localStorage.getItem(USER_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function writeSession(next) {
  session = next;
  try {
    if (next) localStorage.setItem(USER_KEY, JSON.stringify(next));
    else localStorage.removeItem(USER_KEY);
  } catch {
    /* 忽略写入失败 */
  }
  listeners.forEach((fn) => fn(session));
}

export function getSession() {
  return session;
}

export function onSessionChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function isTeacher(user = session) {
  return user?.role === "teacher" || user?.role === "admin";
}

export function isAdmin(user = session) {
  return user?.role === "admin";
}

export async function login(username, password) {
  const data = await authApi.login(username, password);
  setToken(data.token);
  writeSession(data.user);
  return session;
}

export async function register({ username, password, displayName }) {
  const data = await authApi.register({ username, password, displayName });
  setToken(data.token);
  writeSession(data.user);
  return session;
}

export function logout() {
  setToken("");
  writeSession(null);
}

/** 页面启动时校验 token 是否还有效；失效就清掉登录态 */
export async function restoreSession() {
  if (!getToken()) {
    writeSession(null);
    return null;
  }
  try {
    const data = await authApi.me();
    writeSession(data.user);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      // token 失效：清空登录态，回到门禁
      writeSession(null);
    } else {
      // 服务暂时连不上：保留本机登录态，界面照常进入
      writeSession(session);
    }
  }
  return session;
}
