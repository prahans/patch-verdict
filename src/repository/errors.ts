export class RepositoryPreparationError extends Error {
  constructor(
    public readonly outcome: "UNSUPPORTED_REPOSITORY" | "PREPARATION_FAILED",
    message: string,
  ) {
    super(message.slice(0, 2000));
    this.name = "RepositoryPreparationError";
  }
}
