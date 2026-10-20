const SETTINGS_KEY = "exam-workspace:vision:settings";

export const VISION_PRESETS = [
  {
    id: "zhipu-flash",
    label: "智谱 GLM-4V-Flash（免费）",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    model: "glm-4v-flash",
    note: "BigModel 的免费视觉模型，免费额度以控制台为准",
  },
  {
    id: "dashscope-flash",
    label: "百炼 Qwen3-VL-Flash（限免）",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    model: "qwen3-vl-flash",
    note: "百炼新用户每模型系列有免费 token 额度，以控制台为准",
  },
  {
    id: "dashscope-plus",
    label: "百炼 Qwen3-VL-Plus（付费）",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    model: "qwen3-vl-plus",
    note: "识别更准，按 token 计费",
  },
  {
    id: "ollama",
    label: "本地 Ollama（免 Key）",
    baseUrl: "http://localhost:11434/v1",
    model: "qwen2.5vl:7b",
    note: "需要本机已拉取视觉模型，完全离线",
  },
  {
    id: "custom",
    label: "自定义接口",
    baseUrl: "",
    model: "",
    note: "任何 OpenAI 兼容的视觉接口都可以",
  },
];

export const DEFAULT_VISION_SETTINGS = {
  baseUrl: VISION_PRESETS[0].baseUrl,
  apiKey: "",
  model: VISION_PRESETS[0].model,
};

export const VISION_PROMPT = [
  "你是试卷题目整理助手。请阅读这张试卷页面图片，只输出 JSON，不要输出任何解释。",
  '输出格式：{"questions":[{"type":"single|multiple|judge","title":"题干","options":[{"key":"A","content":"选项内容"}],"answer":"A","explanation":"解析，没有就留空","hasFigure":false}]}',
  "规则：",
  "1. 保留化学式与数学式的原始含义，无法确认时输出可读的近似写法。",
  '2. 判断题 type 用 judge，options 输出 [{"key":"A"},{"key":"B"}]，answer 用 "正确" 或 "错误"。',
  "3. 单选题 type 用 single，多选题用 multiple；answer 只写选项字母，多选按 A,B 逗号分隔。",
  "4. 页面上看不到答案时 answer 输出空字符串，不要猜测。",
  "5. 题干中出现图片、结构图或复杂公式时，hasFigure 输出 true。",
  "6. 一页上的每道题都要单独输出，不要合并，也不要输出页眉、页脚和姓名班级等信息。",
  "7. 页面没有题目时输出 {\"questions\":[]}。",
  "8. 必须输出严格有效的 JSON；字符串中的双引号、反斜杠和换行要按 JSON 规则转义，不要添加注释或尾随逗号。",
].join("\n");

function readStore() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (error) {
    console.warn("[视觉 AI] 读取设置失败", error);
    return null;
  }
}

function writeStore(value) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(value));
  } catch (error) {
    console.warn("[视觉 AI] 保存设置失败", error);
  }
}

export function loadVisionSettings() {
  const saved = readStore();
  return {
    baseUrl: String(saved?.baseUrl || DEFAULT_VISION_SETTINGS.baseUrl).trim().replace(/\/+$/, ""),
    apiKey: String(saved?.apiKey || "").trim(),
    model: String(saved?.model || DEFAULT_VISION_SETTINGS.model).trim(),
  };
}

export function saveVisionSettings(settings) {
  writeStore({
    baseUrl: String(settings?.baseUrl || "").trim().replace(/\/+$/, "") || DEFAULT_VISION_SETTINGS.baseUrl,
    apiKey: String(settings?.apiKey || "").trim(),
    model: String(settings?.model || "").trim() || DEFAULT_VISION_SETTINGS.model,
  });
}

export function canvasToJpegDataUrl(canvas, { maxWidth = 1280, quality = 0.75 } = {}) {
  if (canvas.width <= maxWidth) return canvas.toDataURL("image/jpeg", quality);
  const scale = maxWidth / canvas.width;
  const scaled = document.createElement("canvas");
  scaled.width = Math.max(1, Math.round(canvas.width * scale));
  scaled.height = Math.max(1, Math.round(canvas.height * scale));
  const context = scaled.getContext("2d");
  context.fillStyle = "#fff";
  context.fillRect(0, 0, scaled.width, scaled.height);
  context.drawImage(canvas, 0, 0, scaled.width, scaled.height);
  return scaled.toDataURL("image/jpeg", quality);
}

function endpointOf(baseUrl) {
  const base = String(baseUrl || "").trim().replace(/\/+$/, "");
  if (!base) return "";
  return /\/chat\/completions$/.test(base) ? base : `${base}/chat/completions`;
}

function describeHttpError(status, message) {
  if (status === 401 || status === 403) return `API Key 无效或没有该模型权限${message ? `（${message}）` : ""}`;
  if (status === 404 || /model.*(not|不存在|invalid|unavailable)/i.test(message || "")) {
    return `模型名不可用（${status}）：${message || "接口未找到该模型"}，可点「拉取模型」确认账号里的名称`;
  }
  if (status === 429) return "请求过于频繁或免费额度用尽，请稍后再试";
  if (status === 400 && /Arrearage|欠费|quota/i.test(message || "")) {
    return `账号欠费或额度不足：${message}`;
  }
  return `接口返回 ${status}${message ? `：${message}` : ""}`;
}

export function visionPresetOf(settings) {
  const baseUrl = String(settings?.baseUrl || "").trim().replace(/\/+$/, "");
  const model = String(settings?.model || "").trim();
  return VISION_PRESETS.find((preset) => preset.baseUrl === baseUrl && preset.model === model) || null;
}

function messageText(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((item) => (typeof item === "string" ? item : item?.text || "")).join("");
  }
  return "";
}

async function postChat(endpoint, settings, body, signal) {
  let response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${settings.apiKey}`,
      },
      body: JSON.stringify(body),
    });
  } catch (error) {
    if (error?.name === "AbortError") throw error;
    throw new Error("无法连接接口：可能是跨域被拒绝、网络不通或接口地址写错");
  }
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message = payload?.error?.message || payload?.message || "";
    throw new Error(describeHttpError(response.status, message));
  }
  return payload;
}

export function extractJsonText(text) {
  const raw = String(text || "").trim();
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenced ? fenced[1] : raw).trim();
  const objectStart = candidate.indexOf("{");
  const arrayStart = candidate.indexOf("[");
  const starts = [objectStart, arrayStart].filter((index) => index >= 0);
  if (!starts.length) throw new Error("模型没有返回可解析的 JSON");
  const slice = candidate.slice(Math.min(...starts));
  const end = Math.max(slice.lastIndexOf("}"), slice.lastIndexOf("]"));
  return end > 0 ? slice.slice(0, end + 1) : slice;
}

function repairJsonText(text) {
  let result = "";
  let inString = false;
  let escaped = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (inString) {
      if (escaped) {
        if (!`"\\/bfnrtu`.includes(character)) result += "\\";
        result += character;
        escaped = false;
      } else if (character === "\\") {
        result += character;
        escaped = true;
      } else if (character === '"') {
        let nextIndex = index + 1;
        while (/\s/.test(text[nextIndex] || "") && nextIndex < text.length) nextIndex += 1;
        if (nextIndex === text.length || [",", ":", "}", "]"].includes(text[nextIndex])) {
          result += character;
          inString = false;
        } else {
          result += '\\"';
        }
      } else if (character === "\n") {
        result += "\\n";
      } else if (character === "\r") {
        result += "\\r";
      } else if (character === "\t") {
        result += "\\t";
      } else {
        result += character;
      }
      continue;
    }

    if (character === '"') {
      inString = true;
      result += character;
    } else if (character === ",") {
      let nextIndex = index + 1;
      while (/\s/.test(text[nextIndex] || "") && nextIndex < text.length) nextIndex += 1;
      if (![ "}", "]" ].includes(text[nextIndex])) result += character;
      else index = nextIndex - 1;
    } else {
      result += character;
    }
  }

  return result;
}

function parseVisionJson(text) {
  const candidate = extractJsonText(text);
  try {
    return JSON.parse(candidate);
  } catch (originalError) {
    try {
      return JSON.parse(repairJsonText(candidate));
    } catch {
      const error = new Error(
        `模型返回的内容不是有效 JSON，且无法自动修复。请重试或改用本地 OCR。${originalError.message}`,
        { cause: originalError },
      );
      throw error;
    }
  }
}

export async function requestVisionJson({ imageDataUrl, prompt, settings, signal, maxTokens = 2048 }) {
  const endpoint = endpointOf(settings?.baseUrl);
  if (!endpoint) throw new Error("请先填写视觉 AI 接口地址");
  if (!settings?.model) throw new Error("请先填写模型名称");
  if (!settings?.apiKey) throw new Error("请先填写 API Key");

  const payload = await postChat(
    endpoint,
    settings,
    {
      model: settings.model,
      temperature: 0,
      max_tokens: maxTokens,
      messages: [
        {
          role: "user",
          content: [
            { type: "image_url", image_url: { url: imageDataUrl } },
            { type: "text", text: prompt },
          ],
        },
      ],
    },
    signal,
  );

  const content = messageText(payload?.choices?.[0]?.message?.content);
  return parseVisionJson(content);
}

export async function testVisionConnection(settings, signal) {
  const endpoint = endpointOf(settings?.baseUrl);
  if (!endpoint) throw new Error("请先填写视觉 AI 接口地址");
  if (!settings?.model) throw new Error("请先填写模型名称");
  if (!settings?.apiKey) throw new Error("请先填写 API Key");

  const payload = await postChat(
    endpoint,
    settings,
    {
      model: settings.model,
      max_tokens: 16,
      messages: [{ role: "user", content: [{ type: "text", text: "回复 ok" }] }],
    },
    signal,
  );
  if (!messageText(payload?.choices?.[0]?.message?.content) && !payload?.choices?.length) {
    throw new Error("接口没有返回内容，请检查模型名称");
  }
  return true;
}

export async function fetchVisionModels(settings) {
  const base = String(settings?.baseUrl || "")
    .trim()
    .replace(/\/+$/, "")
    .replace(/\/chat\/completions$/, "");
  if (!base) throw new Error("请先填写接口地址");

  let response;
  try {
    response = await fetch(`${base}/models`, {
      headers: settings?.apiKey ? { Authorization: `Bearer ${settings.apiKey}` } : {},
    });
  } catch (error) {
    throw new Error("无法获取模型列表：可能是跨域被拒绝或网络不通");
  }

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message = payload?.error?.message || payload?.message || "";
    throw new Error(`接口不支持拉取模型列表（${response.status}）${message ? `：${message}` : "，请手动填写模型名"}`);
  }

  const list = Array.isArray(payload?.data)
    ? payload.data
    : Array.isArray(payload?.models)
      ? payload.models
      : [];
  const ids = [...new Set(
    list
      .map((item) => String(item?.id ?? item?.model ?? item?.name ?? "").trim())
      .filter(Boolean),
  )].sort();
  if (!ids.length) throw new Error("接口没有返回模型列表，请手动填写模型名");
  return ids;
}
