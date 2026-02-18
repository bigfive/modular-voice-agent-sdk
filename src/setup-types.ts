/**
 * Shared types for model setup and configuration.
 * Used by both the CLI and programmatic setup API.
 */

export interface ModelConfig {
  url: string;
  filename?: string;
  extract?: boolean;
  directory?: string;
  sha256?: string;
  size?: number;
}

export interface SetupConfig {
  models: Record<string, ModelConfig>;
}

export interface ModelStatus {
  name: string;
  installed: boolean;
  path: string;
  expectedFilename?: string;
}
