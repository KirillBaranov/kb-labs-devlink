# Package Architecture Audit: @kb-labs/devlink-core (CLI aspect)

**Date**: 2025-11-16  
**Package Version**: 0.1.0

## 1. Notes on CLI Integration

Манифест DevLink (ManifestV2) присутствует, но на момент аудита:

- `pnpm kb devlink --help` → `Unknown command: devlink`
- В `kb --help` продукт `devlink` не отображается.

Это означает, что DevLink-плагин пока не подключён к текущей версии KB CLI так же, как `analytics`/`release`/`mind`/AI‑продукты.

## 2. CLI Commands Audit (product-level)

| Product    | Status                       | Notes                                                                 |
|------------|------------------------------|-----------------------------------------------------------------------|
| `devlink`  | **Broken (not registered)**  | Manifest есть, но `kb devlink --help` не работает, продукт не виден   |

Рекомендуется на уровне `kb` подключить DevLink manifest к registry/command‑router, чтобы `kb devlink …` работал аналогично другим плагинам.


