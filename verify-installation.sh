#!/bin/bash

# Website Modifier - Installation Verification Script
# Run this to verify all files are present before loading in Chrome

echo "╔════════════════════════════════════════════════════════════════╗"
echo "║         Website Modifier - Installation Verification          ║"
echo "╚════════════════════════════════════════════════════════════════╝"
echo ""

# Color codes
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

ERRORS=0

# Function to check file exists
check_file() {
    if [ -f "$1" ]; then
        echo -e "${GREEN}✓${NC} $1"
    else
        echo -e "${RED}✗${NC} $1 - MISSING!"
        ERRORS=$((ERRORS + 1))
    fi
}

# Check extension folder exists
if [ ! -d "extension" ]; then
    echo -e "${RED}ERROR: extension/ folder not found!${NC}"
    echo "Make sure you're running this script from the project root."
    exit 1
fi

echo "Checking core files..."
check_file "extension/manifest.json"
echo ""

echo "Checking popup files..."
check_file "extension/popup/popup.html"
check_file "extension/popup/popup.css"
check_file "extension/popup/popup.js"
echo ""

echo "Checking content script..."
check_file "extension/content/content.js"
echo ""

echo "Checking background script..."
check_file "extension/background/background.js"
echo ""

echo "Checking config files..."
check_file "extension/config/config.html"
check_file "extension/config/config.css"
check_file "extension/config/config.js"
echo ""

echo "Checking icons..."
check_file "extension/icons/icon16.png"
check_file "extension/icons/icon48.png"
check_file "extension/icons/icon128.png"
echo ""

echo "Checking documentation..."
check_file "README.md"
check_file "QUICK_START.md"
check_file "TROUBLESHOOTING.md"
echo ""

# Final result
echo "════════════════════════════════════════════════════════════════"
if [ $ERRORS -eq 0 ]; then
    echo -e "${GREEN}✓ All files present! Ready to install.${NC}"
    echo ""
    echo "Next steps:"
    echo "1. Open Chrome"
    echo "2. Go to: chrome://extensions/"
    echo "3. Enable 'Developer mode' (top right)"
    echo "4. Click 'Load unpacked'"
    echo "5. Select the 'extension' folder from this project"
    echo ""
    echo "Then configure your OpenAI API key and start transforming!"
else
    echo -e "${RED}✗ $ERRORS file(s) missing!${NC}"
    echo "Please check the installation and try again."
    exit 1
fi
echo "════════════════════════════════════════════════════════════════"
