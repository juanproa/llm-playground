/**
 * Filter model thinking/reasoning from output.
 *
 * Strategy: strip ALL known thinking patterns, return only the clean answer.
 * The raw output with thinking is preserved in the database.
 *
 * VERSION: v2-aggressive (MedGemma untagged thinking)
 */

export interface ParsedOutput {
  answer: string;
  thinkingBlocks: string[];
  hasThinking: boolean;
}

// ─── Detection helpers ──────────────────────────────────────────────────────

/**
 * Text that begins an answer (structural markers or common answer openers).
 * When matched at the very start, this suppresses thinking-detection so the
 * legitimate answer is shown immediately.
 */
const ANSWER_PREFIX_RE =
  /^\s*(\{|\[|```|<[a-zA-Z]|"|'|here\s+(is|are)|the\s+(answer|result|classification|category|output|document|response|value)\s+is|based\s+on|this\s+is\s+a|answer\s*:|classification\s*:|```json)/i;

/**
 * Any text containing these phrases is reasoning, not an answer.  Matched
 * ANYWHERE in the output (not just at start) — if these appear at all, the
 * output is internal reasoning.  The regex is narrow: only phrases that never
 * legitimately appear in a classification / JSON / extraction answer.
 */
const THINKING_ANYWHERE_RE =
  /\b(the user wants me|the user is asking|the user wants to|let me (think|analyze|break (this|it)|start by|go through|look at|see|figure)|let's (think|analyze|start|see|break)|i need to (extract|analyze|classify|figure|identify|determine|understand)|i'll (start|need|analyze|extract|look)|i should (start|classify|extract|look|consider|analyze)|i'?m going to|first,? (i|let)|okay,? (let|the user|so)|alright,? (let|the user)|step \d+:|\*\*document analysis\*\*|\*\*initial scan\*\*|\*\*analysis\*\*|\*\*reasoning\*\*|\*\*thinking\*\*|\*\*my reasoning)/i;

/**
 * Structural answer markers — presence of any of these means the model has
 * started producing the actual answer (typically after reasoning prose).
 */
function hasStructuralAnswerMarker(text: string): boolean {
  return (
    text.includes('```')
    || /\n\s*\{/.test(text)
    || /^\s*\{/.test(text)
    || /^\s*\[/.test(text)
  );
}

// ─── Structured-output splitters ────────────────────────────────────────────

/**
 * Split on the FINAL markdown code fence.  Everything before a substantial
 * prose preamble is treated as reasoning.
 */
function splitOnFinalCodeFence(text: string): { thinking: string; answer: string } | null {
  const fenceRe = /```[a-zA-Z0-9_-]*\s*\n/g;
  let lastIdx = -1;
  let m: RegExpExecArray | null;
  while ((m = fenceRe.exec(text)) !== null) {
    lastIdx = m.index;
  }
  if (lastIdx < 0) return null;

  const prose = text.slice(0, lastIdx).trim();
  if (prose.length < 200) return null;

  return { thinking: prose, answer: text.slice(lastIdx).trim() };
}

/**
 * Fallback: long prose preamble then a `\n{` with balanced braces through end.
 */
function splitOnTrailingJson(text: string): { thinking: string; answer: string } | null {
  for (let i = 0; i < text.length; i++) {
    const isStart = text[i] === '{' && (i === 0 || text[i - 1] === '\n');
    if (!isStart) continue;
    if (text.slice(0, i).trim().length < 200) continue;

    let depth = 0;
    let inString = false;
    let escape = false;
    let balanced = false;
    for (let j = i; j < text.length; j++) {
      const ch = text[j];
      if (escape) { escape = false; continue; }
      if (ch === '\\') { escape = true; continue; }
      if (ch === '"') { inString = !inString; continue; }
      if (inString) continue;
      if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) {
          if (text.slice(j + 1).trim().length === 0) balanced = true;
          break;
        }
      }
    }
    if (balanced) {
      return { thinking: text.slice(0, i).trim(), answer: text.slice(i).trim() };
    }
  }
  return null;
}

// ─── Main filter ────────────────────────────────────────────────────────────

function filterOutput(text: string): { clean: string; blocks: string[] } {
  const blocks: string[] = [];
  let t = text;

  // Strip tagged-thinking blocks (MedGemma <unused>, generic <think>)
  t = t.replace(/<unused\d+>\s*thought\s*\n([\s\S]*?)<\/unused\d+>/gi, (_m, c) => {
    if (c.trim()) blocks.push(c.trim());
    return '';
  });
  t = t.replace(/<(think|thinking|reasoning)>([\s\S]*?)<\/\1>/gi, (_m, _tag, c) => {
    if (c.trim()) blocks.push(c.trim());
    return '';
  });

  // Orphan/junk tags
  t = t.replace(/<\/?(unused\d+|pad|unk|extra_id_\d+)\s*\/?>/gi, '');
  t = t.replace(/^thought\s*\n/i, '');

  // Untagged thinking: prose → fenced block
  const fenced = splitOnFinalCodeFence(t);
  if (fenced) {
    blocks.push(fenced.thinking);
    t = fenced.answer;
  } else {
    const jsonSplit = splitOnTrailingJson(t);
    if (jsonSplit) {
      blocks.push(jsonSplit.thinking);
      t = jsonSplit.answer;
    }
  }

  return { clean: t.trim(), blocks };
}

// ─── Public API ─────────────────────────────────────────────────────────────

export function parseThinking(text: string): ParsedOutput {
  const { clean, blocks } = filterOutput(text);
  return {
    answer: clean,
    thinkingBlocks: blocks,
    hasThinking: blocks.length > 0,
  };
}

/**
 * Filter streaming output.  Hides reasoning prose until a structural answer
 * marker arrives, then reveals the answer.
 *
 * Decision order:
 *   1. filterOutput already cleanly split → show clean portion.
 *   2. Last code-fence position (after substantial prose) → slice from there.
 *   3. First `\n{` position (after substantial prose) → slice from there.
 *   4. Any thinking-indicator phrase present AND no structural marker → hide.
 *   5. Text begins with an answer marker → show as-is.
 *   6. Short stream (< 120 chars) with no structural marker → show as-is.
 *   7. Longer stream without structural marker → hide as thinking.
 */
export function stripThinkingFromStream(text: string): { visible: string; isThinking: boolean } {
  const { clean, blocks } = filterOutput(text);

  // 1. Complete split already happened.
  if (blocks.length > 0 && clean.length > 0) {
    return { visible: clean, isThinking: false };
  }

  // 2. Fence opener after substantial prose — slice from fence.
  const fenceMatch = /```[a-zA-Z0-9_-]*\s*\n?/g;
  let lastFenceIdx = -1;
  let m: RegExpExecArray | null;
  while ((m = fenceMatch.exec(text)) !== null) {
    lastFenceIdx = m.index;
  }
  if (lastFenceIdx > 0 && text.slice(0, lastFenceIdx).trim().length > 100) {
    return { visible: text.slice(lastFenceIdx), isThinking: false };
  }

  // 3. JSON opener after substantial prose — slice from the `{`.
  const jsonMatch = text.match(/\n\s*\{/);
  if (jsonMatch && typeof jsonMatch.index === 'number') {
    const idx = jsonMatch.index;
    if (text.slice(0, idx).trim().length > 100) {
      return { visible: text.slice(idx), isThinking: false };
    }
  }

  const trimmed = text.trim();
  const structural = hasStructuralAnswerMarker(trimmed);
  const thinkingPhrase = THINKING_ANYWHERE_RE.test(trimmed);
  const answerOpener = ANSWER_PREFIX_RE.test(trimmed);

  // 4. Thinking phrase anywhere + no structural marker → hide.
  if (thinkingPhrase && !structural) {
    return { visible: '', isThinking: true };
  }

  // 5. Explicit answer opener → show.
  if (answerOpener) {
    return { visible: clean || text, isThinking: false };
  }

  // 6. Short stream without markers → show as-is (could be a short answer).
  if (trimmed.length < 120) {
    return { visible: clean || text, isThinking: false };
  }

  // 7. Longer prose without any structural marker → hide.
  if (!structural) {
    return { visible: '', isThinking: true };
  }

  const isThinking = blocks.length > 0 && clean.length === 0;
  return { visible: clean || text, isThinking };
}
