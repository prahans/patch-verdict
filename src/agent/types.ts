export type ToolSuccess<T> = {
  ok: true;
  data: T;
};

export type ToolFailure = {
  ok: false;
  error: string;
};

export type ToolResult<T> = ToolSuccess<T> | ToolFailure;
