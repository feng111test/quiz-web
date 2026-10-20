// 答案标记常见写法：答案：A / 参考答案：C / 【答案】A / （答案）B
const ANSWER_RE =
  /(?:【|\[|（|\()?\s*(?:参考答案|正确答案|标准答案|答案)\s*(?:】|\]|）|\))?\s*[：:=＝]?\s*(?:【|\[|（|\()?\s*(正确|错误|对|错|√|×|[A-F](?:\s*(?:[,，、和及与]|\s)\s*[A-F])*)/i;
const OPTION_RE = /^([A-F])\s*[.．、：:，,)）]?\s*(.*)$/;
const OPTION_SPLIT_RE = /(?:^|\s)([A-F])\s*[.．、：:，,)）]\s*/g;
const NUMBER_HEAD_RE = /^(?:第\s*)?(\d{1,3})\s*(?:题)?\s*[.．、:：]\s*(.*)$/;
const JUDGE_TRUE = ["正确", "对", "√"];
const JUDGE_FALSE = ["错误", "错", "×"];
const PAGE_FOOTER_RE = /^(?:第\s*\d+\s*页(?:\s*(?:共|\/)\s*\d+\s*页)?|\d+\s*\/\s*\d+)$/;

function normalizeLine(line) {
  return String(line ?? "")
    .replace(/[！-～]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0))
    .replace(/[ 　]/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function splitOptionSegments(line) {
  const matches = [...line.matchAll(OPTION_SPLIT_RE)];
  if (matches.length <= 1) return [line];
  return matches.map((match, index) => {
    const end = index + 1 < matches.length ? matches[index + 1].index : line.length;
    return line.slice(match.index, end).trim();
  });
}

function normalizeAnswer(rawAnswer) {
  const value = String(rawAnswer || "").trim();
  if (!value) return { answer: "", type: "single" };
  if (JUDGE_TRUE.includes(value)) return { answer: "正确", type: "judge" };
  if (JUDGE_FALSE.includes(value)) return { answer: "错误", type: "judge" };
  const letters = value.toUpperCase().match(/[A-F]/g);
  if (!letters?.length) return { answer: "", type: "single" };
  const answer = [...new Set(letters)].join(",");
  return { answer, type: letters.length > 1 ? "multiple" : "single" };
}

function splitBlocks(lines) {
  const blocks = [];
  let current = null;
  for (const line of lines) {
    if (PAGE_FOOTER_RE.test(line)) continue;
    const match = line.match(NUMBER_HEAD_RE);
    if (match) {
      if (current) blocks.push(current);
      current = [match[2] || line];
      continue;
    }
    if (current) current.push(line);
  }
  if (current) blocks.push(current);
  return blocks.length ? blocks : [lines];
}

/**
 * 找出答案所在行，并把该行切成「答案之前的正文」和「答案之后的解析」。
 * 这样答案跟选项写在同一行（如 “D．二氧化碳 【答案】A”）时，
 * 选项不会被整行丢掉，答案与解析也不会被吞进最后一个选项。
 */
function extractAnswer(lines) {
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(ANSWER_RE);
    if (!match) continue;
    return {
      index,
      value: match[1],
      before: lines[index].slice(0, match.index).trim(),
      after: lines[index].slice(match.index + match[0].length).trim(),
    };
  }
  return null;
}

function stripExplanationPrefix(line) {
  return line.replace(/^[【\[（(]?\s*(?:解析|答案解析|试题解析|详解)\s*[】\]）)]?\s*[：:＝=]?\s*/, "");
}

function parseBlock(lines) {
  const found = extractAnswer(lines);
  const { answer, type } = normalizeAnswer(found?.value);

  const bodyLines = [];
  const tailLines = [];
  if (found) {
    bodyLines.push(...lines.slice(0, found.index));
    if (found.before) bodyLines.push(found.before);
    if (found.after) tailLines.push(found.after);
    tailLines.push(...lines.slice(found.index + 1));
  } else {
    bodyLines.push(...lines);
  }

  const options = [];
  const titleLines = [];
  for (const line of bodyLines) {
    let consumed = false;
    for (const segment of splitOptionSegments(line)) {
      const match = segment.match(OPTION_RE);
      if (match) {
        if (options.some((option) => option.key === match[1])) continue;
        options.push({ key: match[1], content: match[2].trim() });
        consumed = true;
      } else if (options.length) {
        const last = options[options.length - 1];
        last.content = `${last.content} ${segment}`.trim();
        consumed = true;
      }
    }
    if (!consumed && !options.length) titleLines.push(line);
  }

  const title = titleLines.join("\n").trim();
  if (!title || (options.length < 2 && !answer)) return null;

  const explanation = found
    ? tailLines.map(stripExplanationPrefix).join("\n").trim()
    : "";

  return { title, options, answer, type, explanation };
}

export function parseQuestionsFromText(text) {
  const lines = String(text || "")
    .split(/\r?\n/)
    .map(normalizeLine)
    .filter(Boolean);
  if (!lines.length) return [];
  return splitBlocks(lines).map(parseBlock).filter(Boolean);
}
