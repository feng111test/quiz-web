/**
 * 学生反馈表单 + 教师反馈处理列表。
 * 学生只能提交；教师在列表里采纳（可定位到题目直接校对）或驳回。
 */
import { escapeHtml } from "../../src/question-text.js";
import { getSession, isTeacher } from "../../src/auth.js";
import { feedbackApi } from "../../src/api.js";

const byId = (id) => document.getElementById(id);

function formatTime(value) {
  if (!value) return "";
  const date = new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

export function initFeedbackUI({ showToast, getCurrentQuestion, locateQuestion }) {
  const form = {
    view: byId("feedbackView"),
    target: byId("feedbackTarget"),
    reason: byId("feedbackReason"),
    suggestion: byId("feedbackSuggestion"),
    error: byId("feedbackError"),
    close: byId("feedbackClose"),
    cancel: byId("feedbackCancel"),
    submit: byId("feedbackSubmit"),
    button: byId("feedbackButton"),
  };

  const inbox = {
    button: byId("feedbackInboxButton"),
    badge: byId("feedbackBadge"),
    view: byId("inboxView"),
    list: byId("inboxList"),
    empty: byId("inboxEmpty"),
    close: byId("inboxClose"),
    tabs: document.querySelector(".inbox-tabs"),
  };

  let status = "open";
  let items = [];

  function showError(message) {
    form.error.textContent = message;
    form.error.hidden = !message;
  }

  function openForm() {
    const session = getSession();
    if (!session) {
      showToast?.("请先登录后再反馈题目");
      return false;
    }
    const question = getCurrentQuestion?.();
    if (!question) return false;
    form.target.textContent = `${question.bankName} · ${question.title.slice(0, 60)}${question.title.length > 60 ? "…" : ""}`;
    form.suggestion.value = "";
    showError("");
    form.view.hidden = false;
    form.suggestion.focus();
    return true;
  }

  function closeForm() {
    form.view.hidden = true;
  }

  async function submitFeedback() {
    const question = getCurrentQuestion?.();
    if (!question) return;
    const suggestion = form.suggestion.value.trim();
    if (!suggestion) {
      showError("请填写反馈内容");
      return;
    }
    form.submit.disabled = true;
    try {
      await feedbackApi.create({
        bankId: question.bankId,
        questionId: question.id,
        questionTitle: question.title.slice(0, 500),
        bankName: question.bankName,
        reason: form.reason.value,
        suggestion,
      });
      showToast?.("已提交反馈，教师处理后会更新题库");
      closeForm();
      refreshBadge();
    } catch (error) {
      showError(error.message || "提交失败");
    } finally {
      form.submit.disabled = false;
    }
  }

  async function refreshBadge() {
    if (!isTeacher()) {
      inbox.button.hidden = true;
      return;
    }
    try {
      const data = await feedbackApi.inbox("open");
      const count = data.feedback?.length ?? 0;
      // 只有学生真的提交过反馈，教师才看到“反馈处理”入口
      inbox.button.hidden = count === 0;
      inbox.badge.textContent = String(count);
      inbox.badge.hidden = false;
    } catch {
      inbox.button.hidden = true;
    }
  }

  async function loadInbox() {
    inbox.list.innerHTML = `<p class="modal-hint">正在加载反馈…</p>`;
    try {
      const data = await feedbackApi.inbox(status);
      items = Array.isArray(data.feedback) ? data.feedback : [];
    } catch (error) {
      items = [];
      inbox.list.innerHTML = `<p class="auth-error">加载失败：${escapeHtml(error.message || "")}</p>`;
      return;
    }
    inbox.empty.hidden = items.length > 0;
    inbox.list.innerHTML = items
      .map(
        (item) => `<article class="inbox-item">
          <header class="inbox-item-head">
            <span class="inbox-reason">${escapeHtml(item.reason || "其他")}</span>
            <span class="inbox-meta">${escapeHtml(item.authorName || "")} · ${escapeHtml(formatTime(item.createdAt))}</span>
          </header>
          <p class="inbox-question">${escapeHtml(item.bankName || item.bankId)} · ${escapeHtml(item.questionTitle || item.questionId)}</p>
          <p class="inbox-suggestion">${escapeHtml(item.suggestion || "")}</p>
          ${
            item.status === "open"
              ? `<footer class="inbox-actions">
                   <button class="button button-primary" type="button" data-act="accept" data-id="${item.id}">采纳并定位到题目</button>
                   <button class="button button-quiet" type="button" data-act="reject" data-id="${item.id}">驳回</button>
                 </footer>`
              : `<p class="inbox-resolved">${item.status === "accepted" ? "已采纳" : "已驳回"} · ${escapeHtml(item.handlerName || "")} ${escapeHtml(formatTime(item.handledAt))}${item.handleNote ? ` · ${escapeHtml(item.handleNote)}` : ""}</p>`
          }
        </article>`,
      )
      .join("");
  }

  function openInbox() {
    if (!isTeacher()) {
      showToast?.("只有教师可以处理反馈");
      return;
    }
    inbox.view.hidden = false;
    loadInbox();
  }

  function closeInbox() {
    inbox.view.hidden = true;
  }

  async function resolve(id, action) {
    if (action === "reject") {
      const note = window.prompt("驳回原因（可留空）", "") ?? "";
      try {
        await feedbackApi.resolve(id, "reject", note.trim());
        showToast?.("已驳回该反馈");
      } catch (error) {
        showToast?.(error.message || "处理失败");
      }
      loadInbox();
      refreshBadge();
      return;
    }
    const item = items.find((entry) => entry.id === id);
    try {
      await feedbackApi.resolve(id, "accept", "");
    } catch (error) {
      showToast?.(error.message || "处理失败");
      return;
    }
    showToast?.("已采纳该反馈，请在校对面板里更新题目内容");
    loadInbox();
    refreshBadge();
    if (item) {
      const located = await locateQuestion?.(item.bankId, item.questionId);
      if (located) closeInbox();
    }
  }

  form.button.addEventListener("click", () => openForm());
  form.close.addEventListener("click", closeForm);
  form.cancel.addEventListener("click", closeForm);
  form.submit.addEventListener("click", submitFeedback);

  inbox.button.addEventListener("click", openInbox);
  inbox.close.addEventListener("click", closeInbox);
  inbox.tabs?.addEventListener("click", (event) => {
    const button = event.target.closest(".segment");
    if (!button) return;
    status = button.dataset.status || "open";
    inbox.tabs.querySelectorAll(".segment").forEach((item) => {
      item.classList.toggle("active", item === button);
    });
    loadInbox();
  });
  inbox.list.addEventListener("click", (event) => {
    const button = event.target.closest("[data-act]");
    if (!button) return;
    resolve(Number(button.dataset.id), button.dataset.act);
  });

  // 学生随时可能提交反馈，教师端定时刷新，确保新反馈能及时出现入口
  const timer = setInterval(() => {
    if (!document.hidden) refreshBadge();
  }, 60000);

  return { refreshBadge, stop: () => clearInterval(timer) };
}
