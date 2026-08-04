import { slugify } from "@/lib/slug";

// Pure, no I/O — a lightweight heuristic to catch likely-duplicate
// SizeGroup names/codes before they're created (e.g. "PANTALONES" vs
// "PANTS") without needing semantic/translation matching. Never blocks
// anything on its own — only used to show a non-blocking warning in the
// UI (see create-size-group-dialog.tsx). Deliberately conservative: a
// missed near-duplicate just means no warning shows, which is the same
// experience as before this existed.

function bigrams(value: string): Set<string> {
  const result = new Set<string>();
  for (let i = 0; i < value.length - 1; i++) {
    result.add(value.slice(i, i + 2));
  }
  return result;
}

// Sørensen–Dice coefficient over character bigrams — a standard, simple
// fuzzy-string-similarity metric (2 * shared bigrams / total bigrams). 1
// means identical, 0 means nothing in common.
export function diceCoefficient(a: string, b: string): number {
  if (a === b) return 1;
  const bigramsA = bigrams(a);
  const bigramsB = bigrams(b);
  if (bigramsA.size === 0 || bigramsB.size === 0) return 0;
  let shared = 0;
  for (const bigram of bigramsA) {
    if (bigramsB.has(bigram)) shared += 1;
  }
  return (2 * shared) / (bigramsA.size + bigramsB.size);
}

const SIMILARITY_THRESHOLD = 0.5;
const MIN_SHARED_PREFIX_LENGTH = 4;

// True if `a` and `b` (already normalized — lowercase, trimmed) are close
// enough to plausibly be the same real-world group typed two different
// ways — e.g. "pantalones" vs "pants" (shared 4-letter prefix "pant"). A
// heuristic, not a semantic/translation match — treat it only as a prompt
// for a human to double check, never as authoritative.
export function looksSimilar(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;

  const prefixLength = Math.min(MIN_SHARED_PREFIX_LENGTH, a.length, b.length);
  if (prefixLength >= MIN_SHARED_PREFIX_LENGTH && a.slice(0, prefixLength) === b.slice(0, prefixLength)) {
    return true;
  }

  return diceCoefficient(a, b) >= SIMILARITY_THRESHOLD;
}

export interface SizeGroupSummary {
  code: string;
  name: string;
}

// Checks a candidate group's code/name against every existing group's
// code/name (all four cross-combinations — a typo'd code can still match
// an existing name, and vice versa) and returns the ones that look
// similar enough to be worth a second look.
export function findSimilarSizeGroups(
  candidate: SizeGroupSummary,
  existing: SizeGroupSummary[],
): SizeGroupSummary[] {
  const candidateCode = slugify(candidate.code);
  const candidateName = slugify(candidate.name);

  return existing.filter((group) => {
    const groupCode = slugify(group.code);
    const groupName = slugify(group.name);
    return (
      looksSimilar(candidateCode, groupCode) ||
      looksSimilar(candidateName, groupName) ||
      looksSimilar(candidateName, groupCode) ||
      looksSimilar(candidateCode, groupName)
    );
  });
}
