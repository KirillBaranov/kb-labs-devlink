#!/bin/bash

# Fix remaining broken imports in devlink-core

CORE_DIR="packages/devlink-core/src"

echo "Fixing remaining imports in devlink-core..."

# Fix all files recursively
find "$CORE_DIR" -name "*.ts" -type f | while read file; do
  echo "Processing: $file"

  # Fix relative imports to adapters (various depths)
  sed -i '' 's|from '\''../filesystem/fs'\''|from '\''@kb-labs/devlink-adapters/filesystem'\''|g' "$file"
  sed -i '' 's|from '\''../../filesystem/fs'\''|from '\''@kb-labs/devlink-adapters/filesystem'\''|g' "$file"
  sed -i '' 's|from '\''../../../filesystem/fs'\''|from '\''@kb-labs/devlink-adapters/filesystem'\''|g' "$file"

  sed -i '' 's|from '\''../utils/fs'\''|from '\''@kb-labs/devlink-adapters/filesystem'\''|g' "$file"
  sed -i '' 's|from '\''../../utils/fs'\''|from '\''@kb-labs/devlink-adapters/filesystem'\''|g' "$file"
  sed -i '' 's|from '\''../../../utils/fs'\''|from '\''@kb-labs/devlink-adapters/filesystem'\''|g' "$file"

  sed -i '' 's|from '\''../utils/hash'\''|from '\''@kb-labs/devlink-contracts'\''|g' "$file"
  sed -i '' 's|from '\''../../utils/hash'\''|from '\''@kb-labs/devlink-contracts'\''|g' "$file"

  sed -i '' 's|from '\''../logging/logger'\''|from '\''@kb-labs/devlink-adapters/logging'\''|g' "$file"
  sed -i '' 's|from '\''../../logging/logger'\''|from '\''@kb-labs/devlink-adapters/logging'\''|g' "$file"
  sed -i '' 's|from '\''../../../logging/logger'\''|from '\''@kb-labs/devlink-adapters/logging'\''|g' "$file"

  sed -i '' 's|from '\''../utils/logger'\''|from '\''@kb-labs/devlink-adapters/logging'\''|g' "$file"
  sed -i '' 's|from '\''../../utils/logger'\''|from '\''@kb-labs/devlink-adapters/logging'\''|g' "$file"

  # Fix watch module imports (moved to adapters)
  sed -i '' 's|from "\\./build-orchestrator"|from "@kb-labs/devlink-adapters/watch"|g' "$file"
  sed -i '' 's|from "\\./process-manager"|from "@kb-labs/devlink-adapters/watch"|g' "$file"
  sed -i '' 's|from "\\./relink-strategies"|from "@kb-labs/devlink-adapters/watch"|g' "$file"
  sed -i '' 's|from "\\./events"|from "@kb-labs/devlink-contracts"|g' "$file"
done

# Fix operations/index.ts for flattened structure
sed -i '' "s|from '\\./types'|from './operations-types'|g" "$CORE_DIR/core/operations/index.ts"
sed -i '' "s|from '\\./lock'|from './lock-freeze'; export * from './lock-apply'|g" "$CORE_DIR/core/operations/index.ts"
sed -i '' "s|from '\\./journal'|from './journal-undo'; export * from './journal-last-apply'|g" "$CORE_DIR/core/operations/index.ts"

echo "✓ Fixed remaining imports"
