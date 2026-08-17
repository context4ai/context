/**
 * Context workspace environment variable declarations.
 */
declare namespace NodeJS {
  interface ProcessEnv {
    /** Non-interactive mode: skip CLI confirmations ("1" | "true"). */
    C4A_ASSUME_YES?: string;

    /** Context CLI cache root override used by tests and local runs. */
    C4A_CONTEXT_CACHE_HOME?: string;

    /** Skip context-cli postinstall hints / auto-link prompts. */
    CONTEXT_CLI_SKIP_AUTO_LINK?: string;

    /** Optional plugin marketplace output root for context-cli build:plugin. */
    C4A_PLUGINS_ROOT?: string;

    /** Node.js standard environment. */
    NODE_ENV?: "development" | "production" | "test";
  }
}
