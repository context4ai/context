export const ExitCode = {
  Success: 0,
  UserError: 1,
  WorkspaceStateError: 2,
  ExternalToolError: 3,
  UserAbort: 4,
} as const;

export type ExitCode = (typeof ExitCode)[keyof typeof ExitCode];
