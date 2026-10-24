const fs = require("fs");
const path = require("path");
const JSZip = require("jszip");

const MP = "D:/Users/fql/WeChatProjects/miniprogram-1/miniprogram";
const DOCX = "F:/BaiduNetdiskDownload/2025年高考化学试卷（山东卷）（解析卷）.docx";

const storage = {};
const logs = [];
let zipCache = null;

global.wx = {
  chooseMessageFile(options) {
    options.success({
      tempFiles: [
        { path: "wxfile://tmp_test.docx", name: path.basename(DOCX), size: fs.statSync(DOCX).size },
      ],
    });
  },
  getFileSystemManager() {
    return {
      readZipEntry(options) {
        if (!options.entries) throw new Error("调用错误：readZipEntry 缺少 entries 参数");
        const entries = {};
        options.entries.forEach((entry) => {
          const file = zipCache.files[entry.path];
          if (!file) {
            entries[entry.path] = { data: undefined, errMsg: "readZipEntry:fail no such file" };
            return;
          }
          // encoding 生效时由微信返回字符串，这里用 JSZip 模拟同样的行为
          const enc = entry.encoding === "base64" ? "base64" : "string";
          file.async(enc).then((value) => {
            entries[entry.path] = { data: value, errMsg: "readZipEntry:ok" };
          });
        });
        Promise.resolve().then(() => options.success({ entries }));
      },
      readFileSync() {
        return "";
      },
    };
  },
  showToast: (o) => logs.push("toast: " + o.title),
  showLoading: (o) => logs.push("loading: " + o.title),
  hideLoading: () => {},
  showModal: (o) => logs.push("modal: " + o.title + " / " + o.content),
  navigateBack: () => logs.push("navigateBack"),
  setStorageSync: (k, v) => (storage[k] = v),
  getStorageSync: (k) => storage[k],
  removeStorageSync: (k) => delete storage[k],
  cloud: { init() {}, callFunction: () => Promise.resolve({ result: {} }) },
  getSystemInfoSync: () => ({ SDKVersion: "3.0.0" }),
  canIUse: () => true,
  onError() {},
  onUnhandledRejection() {},
};

global.getApp = () => ({ globalData: {} });

let page = null;
global.Page = (definition) => {
  page = definition;
  return definition;
};

require(path.join(MP, "pages/import/import.js"));

const vm = Object.assign({}, page);
vm.data = Object.assign({}, page.data);
vm.questions = [];
vm.lastErrors = [];
vm.fromWord = false;
vm.setData = function (patch) {
  vm.data = Object.assign(vm.data, patch);
};
vm.timer = null;

(async () => {
  zipCache = await JSZip.loadAsync(fs.readFileSync(DOCX));

  console.log("--- 1) onChooseFile ---");
  vm.onChooseFile();

  // 等异步的 base64 读取完成
  await new Promise((r) => setTimeout(r, 3000));

  console.log("\n--- 2) 解析结果 ---");
  const parsed = vm.data.parsed;
  console.log("题库名:", vm.data.name);
  console.log("题目数:", parsed && parsed.count);
  console.log("题型:", JSON.stringify(parsed && parsed.typeStat));
  console.log("挂载图片数:", parsed && parsed.figureCount);
  console.log("错误:", JSON.stringify(parsed && parsed.errors));

  if (!vm.questions.length) {
    console.log("\n!! 没有解析出题目");
    return;
  }

  console.log("\n--- 3) 逐题检查 ---");
  vm.questions.forEach((q, i) => {
    const optImages = (q.options || []).reduce((n, o) => n + (o.formulaImages || []).length, 0);
    const gaps = (q.title.match(/〔公式〕/g) || []).length;
    console.log(
      `第${String(i + 1).padStart(2)}题 [${q.type}] 题干${q.title.length}字 公式槽${gaps}` +
        ` | 选项${(q.options || []).length} 选项图${optImages}` +
        ` | 题干图${(q.titleImages || []).length} 解析图${(q.explanationImages || []).length}` +
        ` | 答案${JSON.stringify(q.answer)}`
    );
  });

  console.log("\n--- 4) 交互日志 ---");
  logs.forEach((l) => console.log(" ", l));

  console.log("\n--- 5) 第 1 题详情 ---");
  const q1 = vm.questions[0];
  console.log("题干:", q1.title);
  console.log("题干图:", (q1.titleImages || []).length);
  (q1.options || []