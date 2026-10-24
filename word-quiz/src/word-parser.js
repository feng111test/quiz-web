// Word 试卷纯文本解析：只处理字符串，不依赖 DOM，便于单独测试。
const ANSWER_LABEL_START = /^\s*[【\[（(]?\s*(?:参考答案|正确答案|标准答案|答案)\s*[】\]）)]?\s*[：:＝=]?\s*/i;
const ANALYSIS_LABEL = /【\s*(?:解析|答案解析|试题解析|详解|分析)\s*】/;
const ANALYSIS_LABEL_STRIP = /^[【\[（(]\s*(?:解析|答案解析|试题解析|详解|分析)\s*[】\]）)]?\s*[：:＝=]?\s*/;

export function splitNumberedQuestions(text) {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const choiceSection = lines.findIndex((line) => /^[一二三四五六七八九十]+、.*选择题/.test(line.trim()));
  const first = lines.findIndex(
    (line, index) => index > choiceSection && /^\s*1\s*[.．、]\s*/.test(line),
  );
  if (first < 0) throw new Error("没有识别到从“1.”开始编号的题目");

  const blocks = [];
  let current = [];
  let expected = 1;
  for (const line of lines.slice(first)) {
    const match = line.match(/^\s*(\d{1,2})\s*[.．、]\s*(.*)$/);
    if (match && Number(match[1]) === expected) {
      if (current.length) blocks.push(current.join("\n"));
      current = [match[2]];
      expected += 1;
    } else {
      current.push(line);
    }
  }
  if (current.length) blocks.push(current.join("\n"));
  return blocks;
}

export function answerFromLine(line) {
  const match = line.match(
    /[【\[（(]?\s*(?:参考答案|正确答案|标准答案|答案)\s*[】\]）)]?\s*[：:＝=]?\s*([A-FＡ-Ｆ](?:[\s,，、和及与]*[A-FＡ-Ｆ])*)/i,
  );
  if (!match) return null;
  const answer = match[1]
    .replace(/[Ａ-Ｆ]/g, (letter) => String.fromCharCode(letter.charCodeAt(0) - 0xfee0))
    .match(/[A-F]/gi);
  return answer ? [...new Set(answer.map((letter) => letter.toUpperCase()))] : null;
}

function optionMarkers(line) {
  const markers = [];
  const pattern = /([A-FＡ-Ｆ])\s*[.．、:：]\s*/gi;
  let match;
  while ((match = pattern.exec(line))) {
    const key = match[1].replace(/[Ａ-Ｆ]/g, (letter) =>
      String.fromCharCode(letter.charCodeAt(0) - 0xfee0),
    ).toUpperCase();
    markers.push({ key, start: match.index, end: pattern.lastIndex });
  }
  return markers;
}

function parseChoices(lines) {
  const title = [];
  const options = [];
  const optionKeys = new Set();
  let readingOptions = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    const markers = optionMarkers(line);
    const consecutive =
      markers.length >= 2 &&
      markers.every((marker, index) => index === 0 || marker.key.charCodeAt(0) === markers[index - 1].key.charCodeAt(0) + 1);

    if (consecutive) {
      const prefix = line.slice(0, markers[0].start).trim();
      if (prefix) title.push(prefix);
      markers.forEach((marker, index) => {
        const end = markers[index + 1]?.start ?? line.length;
        const content = line.slice(marker.end, end).trim();
        if (content && !optionKeys.has(marker.key)) {
          options.push({ key: marker.key, content });
          optionKeys.add(marker.key);
        }
      });
      readingOptions = true;
      continue;
    }

    const single = line.match(/^\s*([A-FＡ-Ｆ])(?:\s*[.．、:：]|\s+)\s*(.+)$/i);
    if (single && (readingOptions || single[1].toUpperCase() === "A")) {
      const key = single[1].replace(/[Ａ-Ｆ]/g, (letter) =>
        String.fromCharCode(letter.charCodeAt(0) - 0xfee0),
      ).toUpperCase();
      if (!optionKeys.has(key)) {
        options.push({ key, content: single[2].trim() });
        optionKeys.add(key);
      } else {
        title.push(line);
      }
      readingOptions = true;
      continue;
    }

    if (readingOptions && options.length) {
      options[options.length - 1].content += `\n${line}`;
      continue;
    }

    title.push(line);
  }

  options.sort((a, b) => a.key.localeCompare(b.key));
  return { title: title.join("\n").trim(), options };
}

function parseInstrumentTable(lines) {
  const headerIndex = lines.findIndex((line) => line.includes("实验内容") && line.includes("仪器或材料"));
  if (headerIndex < 0) return null;

  const text = lines.join("");
  const requiredContent = [
    "灼烧海带",
    "坩埚、泥三角",
    "加热浓缩",
    "表面皿、玻璃棒",
    "称量",
    "电子天平、称量纸",
    "量取",
    "移液管、锥",
  ];
  if (!requiredContent.every((part) => text.includes(part))) return null;

  return {
    title: lines.slice(0, headerIndex).join("\n").trim(),
    options: [
      { key: "A", content: "灼烧海带；坩埚、泥三角" },
      { key: "B", content: "加热浓缩 NaCl 溶液；表面皿、玻璃棒" },
      { key: "C", content: "称量 5.0g NaOH 固体；电子天平、称量纸" },
      { key: "D", content: "量取稀溶液；移液管、锥形瓶" },
    ],
    sourceTable: true,
  };
}

export function parseQuestion(block, number) {
  const lines = block.split("\n");
  const answerIndex = lines.findIndex((line) => answerFromLine(line) || ANSWER_LABEL_START.test(line));
  const hasAnswer = answerIndex >= 0;
  const answer = hasAnswer ? answerFromLine(lines[answerIndex]) : null;
  const analysisIndex = lines.findIndex(
    (line, index) => (!hasAnswer || index > answerIndex) && ANALYSIS_LABEL.test(line),
  );
  const stemLines = lines.slice(
    0,
    hasAnswer ? answerIndex : analysisIndex >= 0 ? analysisIndex : lines.length,
  );
  const parsed = parseInstrumentTable(stemLines) || parseChoices(stemLines);
  const isChoice = Boolean(answer) && parsed.options.length >= 2;

  const explanationLines =
    analysisIndex < 0 ? [] : lines.slice(analysisIndex).map((line) => line.replace(ANALYSIS_LABEL_STRIP, ""));

  if (isChoice) {
    if (!parsed.title) return null;
    return {
      id: `question-${number}`,
      number,
      title: parsed.title,
      options: parsed.options,
      sourceTable: parsed.sourceTable,
      answer: answer.slice().sort(),
      type: answer.length > 1 ? "multiple" : "single",
      explanation: explanationLines.join("\n").trim(),
    };
  }

  // 填空 / 解答题：整段题干 + 原文文本答案（可多行）
  const title = stemLines.join("\n").trim();
  if (!title) return null;
  const answerLines = hasAnswer
    ? lines.slice(answerIndex, analysisIndex < 0 ? lines.length : analysisIndex)
    : [];
  if (answerLines.length) {
    answerLines[0] = answerLines[0].replace(ANSWER_LABEL_START, "").trim();
  }
  return {
    id: `question-${number}`,
    number,
    title,
    options: [],
    answerText: answerLines.join("\n").trim(),
    type: "subjective",
    explanation: explanationLines.join("\n").trim(),
  };
}

export function parseQuestionBank(text) {
  const blocks = splitNumberedQuestions(text);
  const questions = [];
  const skipped = [];
  blocks.forEach((block, index) => {
    const question = parseQuestion(block, index + 1);
    if (question) questions.push(question);
    else skipped.push(index + 1);
  });
  if (!questions.length) {
    throw new Error("没有解析到可用题目，请确认文档包含带编号的题目与答案解析");
  }
  return { questions, skipped };
}
