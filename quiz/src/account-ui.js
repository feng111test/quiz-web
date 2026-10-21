/**
 * 顶栏登录区 + 登录/注册弹窗。
 * 只负责界面与登录态；权限判定始终以服务端返回为准。
 */
import { getSession, login, logout, onSessionChange, register, restoreSession } from "../../src/auth.js";

const byId = (id) => document.getElementById(id);

export function initAccountUI({ showToast, onSessionChange: handleChange }) {
  const ui = {
    user: byId("authUser"),
    button: byId("authButton"),
    logout: byId("authLogout"),
    inbox: byId("feedbackInboxButton"),
    view: byId("authView"),
    title: byId("authTitle"),
    close: byId("authClose"),
    cancel: byId("authCancel"),
    submit: byId("authSubmit"),
    username: byId("authUsername"),
    password: byId("authPassword"),
    displayName: byId("authDisplayName"),
    displayNameField: byId("authDisplayNameField"),
    error: byId("authError"),
    switchMode: byId("authSwitch"),
    hint: byId("authHint"),
    gateHint: byId("authGateHint"),
  };

  let mode = "login";
  // 未登录时登录框是强制门禁，不能关闭
  let locked = true;

  function setMode(next) {
    mode = next === "register" ? "register" : "login";
    const registering = mode === "register";
    ui.title.textContent = registering ? "注册学生账号" : "登录";
    ui.submit.textContent = registering ? "注册并登录" : "登录";
    ui.switchMode.textContent = registering ? "已有账号？去登录" : "没有账号？注册学生账号";
    ui.displayNameField.hidden = !registering;
    ui.error.hidden = true;
  }

  function showError(message) {
    ui.error.textContent = message;
    ui.error.hidden = !message;
  }

  function openView(nextMode = "login") {
    setMode(nextMode);
    ui.view.hidden = false;
    ui.username.focus();
  }

  function closeView() {
    if (locked) return;
    ui.view.hidden = true;
    showError("");
  }

  function render() {
    const session = getSession();
    locked = !session;
    // 未登录：整个应用锁在登录门禁上，题库与刷题页都不显示
    document.body.classList.toggle("needs-auth", locked);
    ui.close.hidden = locked;
    ui.cancel.hidden = locked;
    ui.gateHint.hidden = !locked;
    ui.hint.hidden = locked;
    if (locked) {
      setMode("login");
      ui.view.hidden = false;
    } else {
      ui.view.hidden = true;
      showError("");
    }
    if (session) {
      ui.user.textContent = `${session.displayName || session.username}（${session.roleLabel || session.role}）`;
      ui.user.hidden = false;
      ui.button.hidden = true;
      ui.logout.hidden = false;
    } else {
      ui.user.hidden = true;
      ui.button.hidden = false;
      ui.logout.hidden = true;
    }
    handleChange?.(session);
  }

  async function submit() {
    const username = ui.username.value.trim();
    const password = ui.password.value;
    if (!username || !password) {
      showError("请输入用户名和密码");
      return;
    }
    ui.submit.disabled = true;
    showError("");
    try {
      if (mode === "register") {
        await register({ username, password, displayName: ui.displayName.value.trim() });
        showToast?.("注册成功，已登录为学生账号");
      } else {
        await login(username, password);
        showToast?.("登录成功");
      }
      ui.password.value = "";
      closeView();
    } catch (error) {
      showError(error.message || "操作失败");
    } finally {
      ui.submit.disabled = false;
    }
  }

  ui.button.addEventListener("click", () => openView("login"));
  ui.close.addEventListener("click", closeView);
  ui.cancel.addEventListener("click", closeView);
  ui.submit.addEventListener("click", submit);
  ui.switchMode.addEventListener("click", () => setMode(mode === "login" ? "register" : "login"));
  ui.logout.addEventListener("click", () => {
    logout();
    showToast?.("已退出登录");
  });
  [ui.username, ui.password, ui.displayName].forEach((input) => {
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        submit();
      }
    });
  });

  onSessionChange(render);
  setMode("login");
  render();

  return {
    openLogin: () => openView("login"),
    // restoreSession 内部一定会触发一次登录态变化，这里不再重复 render，
    // 避免题库被并发加载两次
    restore: () => restoreSession(),
  };
}
