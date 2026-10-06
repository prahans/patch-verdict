function normalizePath(value: string) {
  return value.replace(/\\/g, "/").replace(/^\.\//, "").trim();
}

function pathDepth(value: string) {
  return normalizePath(value)
    .split("/")
    .filter(Boolean).length;
}

function basename(value: string) {
  return normalizePath(value).split("/").filter(Boolean).at(-1) ?? "";
}

function stem(value: string) {
  const name = basename(value);
  const index = name.lastIndexOf(".");
  return index > 0 ? name.slice(0, index) : name;
}

function editDistance(a: string, b: string) {
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);

  for (let i = 1; i <= a.length; i++) {
    const current = [i];

    for (let j = 1; j <= b.length; j++) {
      current[j] = Math.min(
        current[j - 1]! + 1,
        previous[j]! + 1,
        previous[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }

    for (let j = 0; j < current.length; j++) {
      previous[j] = current[j]!;
    }
  }

  return previous[b.length]!;
}

export type DiscoveredReadPathValidation =
  | {
      ok: true;
      path: string;
    }
  | {
      ok: false;
      error: string;
      suggestions: string[];
    };

export function validateDiscoveredReadPath(
  requestedPath: string,
  discoveredFiles: readonly string[],
  discoveredDepth: number,
): DiscoveredReadPathValidation {
  const normalizedRequested = normalizePath(requestedPath);

  if (discoveredDepth <= 0 || discoveredFiles.length === 0) {
    return {
      ok: true,
      path: normalizedRequested,
    };
  }

  /*
   * list_files is depth-bounded. A path deeper than the deepest successful
   * listing has not been disproven, so allow the model to inspect it.
   */
  if (pathDepth(normalizedRequested) > discoveredDepth) {
    return {
      ok: true,
      path: normalizedRequested,
    };
  }

  const normalizedFiles = [
    ...new Set(discoveredFiles.map(normalizePath).filter(Boolean)),
  ];

  if (normalizedFiles.includes(normalizedRequested)) {
    return {
      ok: true,
      path: normalizedRequested,
    };
  }

  const requestedBase = basename(normalizedRequested);
  const requestedStem = stem(normalizedRequested);

  const suggestions = normalizedFiles
    .map((candidate) => {
      const candidateBase = basename(candidate);
      const candidateStem = stem(candidate);

      let score = 99;

      if (candidateBase === requestedBase) {
        score = 0;
      } else if (candidateStem === requestedStem) {
        score = 1;
      } else {
        const distance = editDistance(
          requestedBase.toLowerCase(),
          candidateBase.toLowerCase(),
        );

        if (distance <= 2) {
          score = 2 + distance;
        }
      }

      return {
        candidate,
        score,
      };
    })
    .filter((entry) => entry.score < 99)
    .sort(
      (a, b) =>
        a.score - b.score || a.candidate.localeCompare(b.candidate),
    )
    .slice(0, 5)
    .map((entry) => entry.candidate);

  return {
    ok: false,
    suggestions,
    error: [
      `read_file path "${requestedPath}" was not present in the successful list_files inventory through depth ${discoveredDepth}.`,
      suggestions.length > 0
        ? `Use an exact discovered path. Possible match: ${suggestions.join(", ")}.`
        : "Use an exact path returned by list_files instead of guessing.",
    ].join(" "),
  };
}
