#!/bin/bash

# Script to update imports in devlink-core operations

CORE_DIR="packages/devlink-core/src/core/operations"

echo "Updating imports in core operations..."

# Update all .ts files in operations directory
find "$CORE_DIR" -maxdepth 1 -name "*.ts" -type f | while read file; do
  echo "Processing: $file"

  # Replace infrastructure imports with adapters
  sed -i '' 's|from '\''../infrastructure/state/state'\''|from '\''@kb-labs/devlink-adapters/state'\''|g' "$file"
  sed -i '' 's|from '\''../../../infrastructure/state/state'\''|from '\''@kb-labs/devlink-adapters/state'\''|g' "$file"
  sed -i '' 's|from '\''../../infrastructure/state/state'\''|from '\''@kb-labs/devlink-adapters/state'\''|g' "$file"

  sed -i '' 's|from '\''../utils/runCommand'\''|from '\''@kb-labs/devlink-adapters/process'\''|g' "$file"
  sed -i '' 's|from '\''../../utils/runCommand'\''|from '\''@kb-labs/devlink-adapters/process'\''|g' "$file"

  sed -i '' 's|from '\''../utils/logger'\''|from '\''@kb-labs/devlink-adapters/logging'\''|g' "$file"
  sed -i '' 's|from '\''../../utils/logger'\''|from '\''@kb-labs/devlink-adapters/logging'\''|g' "$file"

  sed -i '' 's|from '\''../infrastructure/filesystem'\''|from '\''@kb-labs/devlink-adapters/filesystem'\''|g' "$file"
  sed -i '' 's|from '\''../../infrastructure/filesystem'\''|from '\''@kb-labs/devlink-adapters/filesystem'\''|g' "$file"

  sed -i '' 's|from '\''../infrastructure/backup'\''|from '\''@kb-labs/devlink-adapters/backup'\''|g' "$file"
  sed -i '' 's|from '\''../../infrastructure/backup'\''|from '\''@kb-labs/devlink-adapters/backup'\''|g' "$file"

  sed -i '' 's|from '\''../infrastructure/analytics'\''|from '\''@kb-labs/devlink-adapters/analytics'\''|g' "$file"
  sed -i '' 's|from '\''../../infrastructure/analytics'\''|from '\''@kb-labs/devlink-adapters/analytics'\''|g' "$file"

  sed -i '' 's|from '\''../infrastructure/vcs'\''|from '\''@kb-labs/devlink-adapters/vcs'\''|g' "$file"
  sed -i '' 's|from '\''../../infrastructure/vcs'\''|from '\''@kb-labs/devlink-adapters/vcs'\''|g' "$file"

  sed -i '' 's|from '\''../infrastructure/process'\''|from '\''@kb-labs/devlink-adapters/process'\''|g' "$file"
  sed -i '' 's|from '\''../../infrastructure/process'\''|from '\''@kb-labs/devlink-adapters/process'\''|g' "$file"

  sed -i '' 's|from '\''../infrastructure/time'\''|from '\''@kb-labs/devlink-adapters/time'\''|g' "$file"
  sed -i '' 's|from '\''../../infrastructure/time'\''|from '\''@kb-labs/devlink-adapters/time'\''|g' "$file"

  sed -i '' 's|from '\''../infrastructure/maintenance'\''|from '\''@kb-labs/devlink-adapters/maintenance'\''|g' "$file"
  sed -i '' 's|from '\''../../infrastructure/maintenance'\''|from '\''@kb-labs/devlink-adapters/maintenance'\''|g' "$file"

  sed -i '' 's|from '\''../infrastructure/preflight'\''|from '\''@kb-labs/devlink-adapters/preflight'\''|g' "$file"
  sed -i '' 's|from '\''../../infrastructure/preflight'\''|from '\''@kb-labs/devlink-adapters/preflight'\''|g' "$file"

  sed -i '' 's|from '\''../infrastructure/watch'\''|from '\''@kb-labs/devlink-adapters/watch'\''|g' "$file"
  sed -i '' 's|from '\''../../infrastructure/watch'\''|from '\''@kb-labs/devlink-adapters/watch'\''|g' "$file"

  # Fix relative imports within operations (now all in same dir)
  sed -i '' 's|from '\''./apply/apply'\''|from '\''./apply'\''|g' "$file"
  sed -i '' 's|from '\''./plan/plan'\''|from '\''./plan'\''|g' "$file"
  sed -i '' 's|from '\''./scan/scan'\''|from '\''./scan'\''|g' "$file"
  sed -i '' 's|from '\''./status/status'\''|from '\''./status'\''|g' "$file"
  sed -i '' 's|from '\''./watch/watch'\''|from '\''./watch'\''|g' "$file"
  sed -i '' 's|from '\''./lock/freeze'\''|from '\''./lock-freeze'\''|g' "$file"
  sed -i '' 's|from '\''./lock/apply-lock'\''|from '\''./lock-apply'\''|g' "$file"
  sed -i '' 's|from '\''./journal/undo'\''|from '\''./journal-undo'\''|g' "$file"
  sed -i '' 's|from '\''./journal/last-apply'\''|from '\''./journal-last-apply'\''|g' "$file"
  sed -i '' 's|from '\''./types/types'\''|from '\''./operations-types'\''|g' "$file"
done

echo "✓ Updated imports in core operations"
