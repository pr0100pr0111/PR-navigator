import { sha256Hex } from '../utils/hashing';
import { AnchorResolution, AnchorSide, LineAnchor } from './noteTypes';

export const DEFAULT_CONTEXT_RADIUS = 3;

export interface AnchorResolutionResult {
  resolution: AnchorResolution;
  resolvedLine: number | null;
}

export function toLines(content: string): string[] {
  return content.replace(/\r\n/g, '\n').split('\n');
}

export function computeContextHash(
  lineText: string,
  contextBefore: readonly string[],
  contextAfter: readonly string[],
): string {
  return sha256Hex(JSON.stringify([lineText, contextBefore, contextAfter]));
}

export function createLineAnchor(
  lines: readonly string[],
  lineIndex: number,
  side: AnchorSide,
  radius: number = DEFAULT_CONTEXT_RADIUS,
): LineAnchor {
  const lineText = lines[lineIndex];
  if (lineText === undefined) {
    throw new Error(`Строка ${lineIndex + 1} не существует в этом файле.`);
  }
  const contextBefore = lines.slice(Math.max(0, lineIndex - radius), lineIndex);
  const contextAfter = lines.slice(lineIndex + 1, Math.min(lines.length, lineIndex + 1 + radius));
  return {
    side,
    line: lineIndex + 1,
    lineText,
    contextBefore,
    contextAfter,
    contextHash: computeContextHash(lineText, contextBefore, contextAfter),
    resolution: 'resolved',
    resolvedLine: lineIndex + 1,
  };
}

function contextScore(
  lines: readonly string[],
  matchIndex: number,
  anchor: LineAnchor,
): number {
  let score = 0;
  const before = anchor.contextBefore;
  for (let offset = 1; offset <= before.length; offset += 1) {
    const sourceIndex = matchIndex - offset;
    const expected = before[before.length - offset];
    if (sourceIndex >= 0 && lines[sourceIndex] === expected) {
      score += 1;
    } else {
      break;
    }
  }
  const after = anchor.contextAfter;
  for (let offset = 1; offset <= after.length; offset += 1) {
    const sourceIndex = matchIndex + offset;
    const expected = after[offset - 1];
    if (sourceIndex < lines.length && lines[sourceIndex] === expected) {
      score += 1;
    } else {
      break;
    }
  }
  return score;
}

export function resolveLineAnchor(
  lines: readonly string[],
  anchor: LineAnchor,
): AnchorResolutionResult {
  const matches: number[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index] === anchor.lineText) {
      matches.push(index);
    }
  }
  if (matches.length === 0) {
    return { resolution: 'missing', resolvedLine: null };
  }
  if (matches.length === 1) {
    return { resolution: 'resolved', resolvedLine: matches[0] + 1 };
  }
  const scores = matches.map((matchIndex) => contextScore(lines, matchIndex, anchor));
  const bestScore = Math.max(...scores);
  if (bestScore <= 0) {
    return { resolution: 'ambiguous', resolvedLine: null };
  }
  const winners = scores.filter((score) => score === bestScore);
  if (winners.length > 1) {
    return { resolution: 'ambiguous', resolvedLine: null };
  }
  const winnerIndex = matches[scores.indexOf(bestScore)];
  if (winnerIndex === undefined) {
    return { resolution: 'ambiguous', resolvedLine: null };
  }
  return { resolution: 'resolved', resolvedLine: winnerIndex + 1 };
}
