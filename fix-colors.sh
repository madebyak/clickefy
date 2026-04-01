#!/bin/bash

# Script to fix all Tailwind color references to use hex values instead of CSS variables
# This is needed for Tailwind CSS v4 compatibility

echo "Fixing color references in all component files..."

# Define color mappings
declare -A colors=(
  ["bg-surface"]="bg-[#16161f]"
  ["bg-surface-elevated"]="bg-[#1e1e2a]"
  ["bg-primary-purple"]="bg-[#8b5cf6]"
  ["bg-primary-green"]="bg-[#10b981]"
  ["bg-error"]="bg-[#ef4444]"
  ["bg-warning"]="bg-[#f59e0b]"
  ["bg-success"]="bg-[#10b981]"
  ["bg-background"]="bg-[#0a0a0f]"
  
  ["text-text-primary"]="text-white"
  ["text-text-secondary"]="text-[#a1a1aa]"
  ["text-primary-purple"]="text-[#8b5cf6]"
  ["text-primary-green"]="text-[#10b981]"
  ["text-error"]="text-[#ef4444]"
  ["text-warning"]="text-[#f59e0b]"
  ["text-success"]="text-[#10b981]"
  
  ["border-border"]="border-[#27272a]"
  ["border-error"]="border-[#ef4444]"
  ["border-primary-purple"]="border-[#8b5cf6]"
  
  ["hover:bg-surface"]="hover:bg-[#16161f]"
  ["hover:bg-surface-elevated"]="hover:bg-[#1e1e2a]"
  ["hover:bg-primary-purple"]="hover:bg-[#8b5cf6]"
  ["hover:text-text-primary"]="hover:text-white"
  ["hover:text-primary-purple"]="hover:text-[#8b5cf6]"
  
  ["focus:ring-primary-purple"]="focus:ring-[#8b5cf6]"
  ["focus:ring-error"]="focus:ring-[#ef4444]"
  ["focus:ring-offset-background"]="focus:ring-offset-[#0a0a0f]"
  
  ["placeholder-text-secondary"]="placeholder-[#a1a1aa]"
)

# Find all TypeScript/TSX files in components and app directories
find app components -name "*.tsx" -o -name "*.ts" | while read file; do
  echo "Processing: $file"
  
  # Apply all color replacements
  for old in "${!colors[@]}"; do
    new="${colors[$old]}"
    sed -i '' "s/${old}/${new}/g" "$file"
  done
done

echo "Color fixes complete!"
echo "Restarting dev server..."
