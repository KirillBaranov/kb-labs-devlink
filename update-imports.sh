#!/bin/bash

# Script to update imports in devlink-cli commands

CLI_DIR="packages/devlink-cli/src/commands"

echo "Updating imports in CLI commands..."

# Update all .ts files in CLI commands directory
find "$CLI_DIR" -name "*.ts" -type f | while read file; do
  echo "Processing: $file"

  # Replace REST facade imports
  sed -i '' 's|from '\''../rest'\''|from '\''@kb-labs/devlink-core'\''|g' "$file"
  sed -i '' 's|from "../rest"|from "@kb-labs/devlink-core"|g' "$file"

  # Replace infrastructure imports
  sed -i '' 's|from '\''../filesystem/fs'\''|from '\''@kb-labs/devlink-adapters/filesystem'\''|g' "$file"
  sed -i '' 's|from '\''../infrastructure/filesystem/fs'\''|from '\''@kb-labs/devlink-adapters/filesystem'\''|g' "$file"

  sed -i '' 's|from '\''../infrastructure/analytics/events'\''|from '\''@kb-labs/devlink-adapters/analytics'\''|g' "$file"
  sed -i '' 's|from '\''../analytics/events'\''|from '\''@kb-labs/devlink-adapters/analytics'\''|g' "$file"

  sed -i '' 's|from '\''../time/timestamp'\''|from '\''@kb-labs/devlink-adapters/time'\''|g' "$file"
  sed -i '' 's|from '\''../infrastructure/time/timestamp'\''|from '\''@kb-labs/devlink-adapters/time'\''|g' "$file"

  sed -i '' 's|from '\''../backup/backup-manager'\''|from '\''@kb-labs/devlink-adapters/backup'\''|g' "$file"
  sed -i '' 's|from '\''../infrastructure/backup/backup-manager'\''|from '\''@kb-labs/devlink-adapters/backup'\''|g' "$file"

  sed -i '' 's|from '\''../maintenance/clean'\''|from '\''@kb-labs/devlink-adapters/maintenance'\''|g' "$file"
  sed -i '' 's|from '\''../infrastructure/maintenance/clean'\''|from '\''@kb-labs/devlink-adapters/maintenance'\''|g' "$file"

  # Replace core operations imports
  sed -i '' 's|from '\''../core/operations/apply'\''|from '\''@kb-labs/devlink-core'\''|g' "$file"
  sed -i '' 's|from '\''../core/operations/plan'\''|from '\''@kb-labs/devlink-core'\''|g' "$file"
  sed -i '' 's|from '\''../core/operations/scan'\''|from '\''@kb-labs/devlink-core'\''|g' "$file"
  sed -i '' 's|from '\''../core/operations/status'\''|from '\''@kb-labs/devlink-core'\''|g' "$file"
  sed -i '' 's|from '\''../core/operations/watch'\''|from '\''@kb-labs/devlink-core'\''|g' "$file"
  sed -i '' 's|from '\''../core/operations/lock'\''|from '\''@kb-labs/devlink-core'\''|g' "$file"
  sed -i '' 's|from '\''../core/operations/journal'\''|from '\''@kb-labs/devlink-core'\''|g' "$file"
  sed -i '' 's|from '\''../core/operations/commands'\''|from '\''@kb-labs/devlink-core'\''|g' "$file"
done

echo "✓ Updated imports in CLI commands"
