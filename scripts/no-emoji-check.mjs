#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import emojiRegex from 'emoji-regex';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(__dirname, '..');

const scanDirs = ['frontend/src', 'backend/src', 'shared/src', 'scripts', 'public', 'docs', '.'];
const fileExtensions = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.md', '.json', '.html', '.sh'];
const scanFiles = ['README.md', 'CONTRIBUTING.md', 'CHANGELOG.md', 'package.json'];

// Common emoji patterns to check beyond the regex
const commonEmojiPatterns = [
  /:\w+:/g,           // emoji shortcodes
  /[\u{1F600}-\u{1F64F}]/gu,  // emoticons
  /[\u{1F300}-\u{1F5FF}]/gu,  // symbols & pictographs
  /[\u{1F680}-\u{1F6FF}]/gu,  // transport & map
  /[\u{2600}-\u{26FF}]/gu,    // miscellaneous symbols
  /[\u{2700}-\u{27BF}]/gu     // dingbats
];

class EmojiChecker {
  constructor() {
    this.violationCount = 0;
    this.violations = [];
  }

  checkFile(filePath) {
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const lines = content.split('\n');
      const relativePath = path.relative(projectRoot, filePath);
      
      lines.forEach((line, index) => {
        // Check with emoji-regex
        const regex = emojiRegex();
        const emojiMatches = line.match(regex);
        
        if (emojiMatches) {
          this.violationCount++;
          this.violations.push({
            file: relativePath,
            line: index + 1,
            content: line.trim(),
            emojis: emojiMatches
          });
        }

        // Check common patterns
        for (const pattern of commonEmojiPatterns) {
          const matches = line.match(pattern);
          if (matches) {
            this.violationCount++;
            this.violations.push({
              file: relativePath,
              line: index + 1,
              content: line.trim(),
              emojis: matches
            });
            break; // Don't double-count the same line
          }
        }
      });
    } catch (error) {
      console.warn(`Warning: Could not read ${filePath}: ${error.message}`);
    }
  }

  scanDirectory(dir) {
    if (!fs.existsSync(dir)) {
      return;
    }

    const files = fs.readdirSync(dir);
    
    for (const file of files) {
      const fullPath = path.join(dir, file);
      const stat = fs.statSync(fullPath);
      
      if (stat.isDirectory()) {
        // Skip node_modules and other build directories
        if (!['node_modules', 'dist', 'build', '.git'].includes(file)) {
          this.scanDirectory(fullPath);
        }
      } else {
        const ext = path.extname(file);
        if (fileExtensions.includes(ext)) {
          this.checkFile(fullPath);
        }
      }
    }
  }

  run() {
    console.log('Scanning for emoji violations...');
    
    // Scan directories
    for (const scanDir of scanDirs) {
      const fullPath = path.join(projectRoot, scanDir);
      if (fs.existsSync(fullPath)) {
        if (scanDir === '.') {
          // For root directory, only scan specific files
          for (const fileName of scanFiles) {
            const filePath = path.join(fullPath, fileName);
            if (fs.existsSync(filePath)) {
              this.checkFile(filePath);
            }
          }
        } else {
          this.scanDirectory(fullPath);
        }
      }
    }
    
    if (this.violationCount === 0) {
      console.log('No emoji violations found!');
      return 0; // Success
    }

    console.log(`Found ${this.violationCount} emoji violations:\n`);
    
    // Group violations by file
    const violationsByFile = {};
    this.violations.forEach(v => {
      if (!violationsByFile[v.file]) {
        violationsByFile[v.file] = [];
      }
      violationsByFile[v.file].push(v);
    });

    // Print violations
    for (const [file, violations] of Object.entries(violationsByFile)) {
      console.log(`File: ${file}:`);
      violations.forEach(v => {
        console.log(`  Line ${v.line}: ${v.content}`);
        console.log(`  Emojis: ${v.emojis.join(', ')}`);
      });
      console.log();
    }

    console.log('EMOJI POLICY VIOLATION: Remove all emojis from source code.');
    console.log('Use text alternatives or professional icons instead.');
    
    return 1; // Error
  }
}

// Run the check
const checker = new EmojiChecker();
const exitCode = checker.run();
process.exit(exitCode);