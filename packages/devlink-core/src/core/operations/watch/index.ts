// Экспорт новой версии как единственной
export { DevLinkWatcher, watchDevLink } from "./watch";
export { detectMode } from "./mode-detector";
export { detectBuildCommands, detectWatchPaths, shouldIgnorePath, getWatchPatterns } from "./build-detector";
export { buildReverseDependencyMap, getDirectConsumers, filterProviders, filterConsumers } from "./dependency-resolver";
export * from "./types";
export * from "./events";
export type { AllDevLinkEvents } from "./events";

