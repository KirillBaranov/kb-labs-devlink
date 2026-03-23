# DevLink — Cross-Repo Dependency Manager

DevLink управляет зависимостями между sub-repos в KB Labs монорепо. Одна команда — и все `link:` paths, `pnpm-workspace.yaml`, lockfiles в порядке.

## Quick Start

```bash
# Посмотреть текущее состояние + диагностику
pnpm kb devlink status

# Починить всё: deps + workspace files + lockfiles + install
pnpm kb devlink switch --mode=local --install

# Переключить на npm версии (для публикации)
pnpm kb devlink switch --mode=npm
```

## Что DevLink делает

DevLink владеет **всеми cross-repo зависимостями** — зависимостями между разными git submodules:

| Ответственность | Что делает |
|----------------|-----------|
| **package.json deps** | `link:../../path` (local) ↔ `^1.0.0` (npm) |
| **pnpm-workspace.yaml** | Cross-repo paths в sub-repo workspace файлах |
| **Stale lockfiles** | Автоматическая очистка при switch |
| **Диагностика** | Broken links, stale files, cross-repo workspace:* |

**Что DevLink НЕ трогает:**
- Intra-repo `workspace:*` (core-workspace → core-sys внутри kb-labs-core)
- tsconfig.paths (это ответственность DevKit: `npx kb-devkit-paths`)
- npm registry publishing

## Команды

### `devlink status`

Показывает текущее состояние и проблемы:

```bash
pnpm kb devlink status
```

```
DevLink — Status

Current mode
  Mode: local
  Last applied: 2026-03-23T09:19:39.012Z

Dependency counts
  link: (local)   : 316
  npm (^version)  : 0
  workspace:*     : 41

✅ Health
  No issues detected
```

С `--json` для автоматизации:

```bash
pnpm kb devlink status --json
```

Диагностика проверяет:
- **broken-link** (error) — `link:` path указывает на несуществующую директорию
- **cross-repo-workspace** (warning) — `workspace:*` между разными sub-repos (должен быть `link:`)
- **stale-lockfile** (warning) — lockfile старше package.json

### `devlink switch`

Переключает все cross-repo deps между режимами:

```bash
# Preview (ничего не меняет)
pnpm kb devlink switch --mode=local --dry-run

# Переключить на local (development)
pnpm kb devlink switch --mode=local

# Переключить + установить зависимости
pnpm kb devlink switch --mode=local --install

# Переключить на npm (CI/CD, publishing)
pnpm kb devlink switch --mode=npm
```

**Что делает `--install`:**
1. Переключает deps в package.json
2. Обновляет sub-repo pnpm-workspace.yaml (cross-repo paths)
3. Чистит stale lockfiles
4. `pnpm install` в workspace root
5. `pnpm install --prefer-offline` в каждом affected sub-repo

**Флаги:**

| Флаг | Default | Описание |
|------|---------|----------|
| `--mode` | required | `local` или `npm` |
| `--dry-run` | false | Preview без изменений |
| `--install` | false | Запустить pnpm install после switch |
| `--clean-locks` | true | Удалить stale lockfiles |
| `--repos` | all | Ограничить scope: `--repos=kb-labs-core,kb-labs-cli` |
| `--json` | false | JSON output |

### `devlink plan`

Preview изменений без применения:

```bash
# Что изменится при переключении на npm?
pnpm kb devlink plan --mode=npm

# Что изменится при переключении на local?
pnpm kb devlink plan --mode=local
```

### `devlink freeze`

Заморозить текущее состояние в lock-файл:

```bash
pnpm kb devlink freeze
# → .kb/devlink/lock.json
```

### `devlink undo`

Откатить последний switch:

```bash
pnpm kb devlink undo
# → восстанавливает package.json из backup
```

### `devlink backups`

Список и восстановление бекапов:

```bash
# Список всех бекапов
pnpm kb devlink backups

# Восстановить конкретный
pnpm kb devlink backups --restore=1774257798817-m9b4m
```

## Режимы работы

### Local mode (development)

```
@kb-labs/core-sys: link:../../../kb-labs-core/packages/core-sys
```

- Изменения в коде видны мгновенно (symlink → source)
- Для ежедневной разработки
- Sub-repos могут работать автономно (`cd sub-repo && pnpm install`)

### NPM mode (publishing / CI)

```
@kb-labs/core-sys: ^1.2.0
```

- Зависимости из npm registry
- Для публикации пакетов и CI/CD
- Private пакеты (devkit) остаются как `link:` (не опубликованы)

## Как это работает

### Discovery

DevLink находит все sub-repos через `.gitmodules` (layout-agnostic — работает с любой структурой директорий). Для каждого sub-repo сканирует все `package.json` и строит карту пакетов:

```
@kb-labs/core-sys → {
  linkPath: "platform/kb-labs-core/packages/core-sys",
  npmVersion: "^1.2.0",
  monorepo: "kb-labs-core",
  private: false
}
```

### Intra vs Cross-repo

DevLink различает:
- **Intra-repo** (`workspace:*`) — core-workspace → core-sys внутри одного sub-repo → НЕ трогает
- **Cross-repo** — cli → core-sys между разными sub-repos → управляет

### Workspace YAML

При `switch` DevLink автоматически обновляет `pnpm-workspace.yaml` в каждом sub-repo:
- Сохраняет intra-repo patterns (`packages/*`, `apps/*`)
- Вычисляет и добавляет cross-repo paths (из зависимостей)
- Результат: `cd sub-repo && pnpm install` работает автономно

## Типичные сценарии

### После миграции / изменения структуры

```bash
pnpm kb devlink switch --mode=local --install
```

Пересчитает все paths, обновит workspace yaml, установит deps.

### Перед публикацией на npm

```bash
pnpm kb devlink switch --mode=npm
pnpm kb release:run --scope=@kb-labs/core
pnpm kb devlink switch --mode=local --install
```

### Проверка здоровья

```bash
pnpm kb devlink status
```

Если есть issues — `switch --mode=local --install` их починит.

### Добавление нового sub-repo

1. Клонировать/создать repo в нужной категории
2. `pnpm sync:submodules:apply` (регистрация в .gitmodules)
3. `pnpm kb devlink switch --mode=local --install`

DevLink автоматически подхватит новый sub-repo и настроит все deps.

## Troubleshooting

### "workspace:* crosses sub-repo boundary"

DevLink обнаружил `workspace:*` зависимость между разными sub-repos. Это не работает — pnpm не видит пакеты из других workspaces.

**Fix:** `pnpm kb devlink switch --mode=local`

### "link: target does not exist"

Пакет был удалён или переименован, но зависимость осталась.

**Fix:** Удалить зависимость из package.json вручную.

### "stale lockfile"

Lockfile старше package.json — deps изменились после последнего install.

**Fix:** `pnpm kb devlink switch --mode=local --install` (чистит lockfiles автоматически)

### DevLink сам сломался после switch

DevLink CLI работает из собранного `dist/` — Node держит модули в памяти. Switch меняет только package.json на диске. Если что-то пошло не так:

```bash
# Откатить
pnpm kb devlink undo

# Или пересобрать
pnpm --filter @kb-labs/devlink-core run build
pnpm --filter @kb-labs/devlink-cli run build
pnpm kb marketplace clear-cache
```
