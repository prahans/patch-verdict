/** Git ref syntax validation only. GitHub confirms existence and canonical name. */
export function isGitHubBranchName(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 1024 &&
    !/[\x00-\x20\x7f~^:?*\[\\]/.test(value) && !value.startsWith("-") &&
    !value.includes("..") && !value.includes("@{") && value !== "@" &&
    !value.endsWith(".") && value.split("/").every((part) =>
      !!part && !part.startsWith(".") && !part.endsWith(".lock"));
}
