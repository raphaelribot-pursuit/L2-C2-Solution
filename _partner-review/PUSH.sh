#!/bin/bash
# Push Wisper Week 2 PRD Branch to GitHub
# Run this script from your local wisper repo folder

echo "🚀 Pushing Wisper Week 2 PRD (Jimmy-fixes branch) to GitHub..."
echo ""

# Check if we're in a git repo
if [ ! -d ".git" ]; then
    echo "❌ ERROR: Not in a git repository!"
    echo "Please run this from your wisper repo folder"
    exit 1
fi

# Check if branch exists
if ! git show-ref --quiet refs/heads/Jimmy-fixes; then
    echo "⚠️  Branch 'Jimmy-fixes' doesn't exist locally"
    echo "Creating it now..."
    git checkout -b Jimmy-fixes
fi

# Ensure we're on the right branch
git checkout Jimmy-fixes

# Push the branch
echo ""
echo "Pushing to GitHub..."
git push -u origin Jimmy-fixes

if [ $? -eq 0 ]; then
    echo ""
    echo "✅ SUCCESS! Branch pushed to GitHub"
    echo ""
    echo "View at: https://github.com/aislingld-pursuit/L2-Clone-Prodject/tree/Jimmy-fixes"
    echo ""
    echo "📧 Share the link with Aisling for review"
else
    echo ""
    echo "❌ Push failed. Check your GitHub credentials and internet connection."
    exit 1
fi
