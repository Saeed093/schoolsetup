// Error checking script
const fs = require('fs');
const path = require('path');

console.log('Checking for errors in the system...\n');

const errors = [];

// Check if all required files exist
const requiredFiles = [
  'server/index.js',
  'server/database/db.js',
  'server/routes/cards.js',
  'server/routes/rfid.js',
  'server/services/rfidService.js',
  'client/src/App.js',
  'client/src/index.js',
  'client/src/pages/Home.js',
  'client/src/pages/ScanView.js',
  'client/src/pages/ManagementView.js',
  'client/src/components/CardManager.js',
  'client/src/components/ScanDisplay.js',
  'client/src/components/ReaderStatus.js',
  'package.json',
  'client/package.json'
];

console.log('1. Checking required files...');
requiredFiles.forEach(file => {
  const filePath = path.join(__dirname, file);
  if (!fs.existsSync(filePath)) {
    errors.push(`Missing file: ${file}`);
    console.log(`  ❌ Missing: ${file}`);
  } else {
    console.log(`  ✅ Found: ${file}`);
  }
});

// Check package.json structure
console.log('\n2. Checking package.json files...');
try {
  const rootPackage = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));
  if (!rootPackage.scripts || !rootPackage.scripts.dev) {
    errors.push('Missing dev script in root package.json');
    console.log('  ❌ Missing dev script');
  } else {
    console.log('  ✅ Root package.json is valid');
  }

  const clientPackage = JSON.parse(fs.readFileSync(path.join(__dirname, 'client/package.json'), 'utf8'));
  if (!clientPackage.dependencies || !clientPackage.dependencies.react) {
    errors.push('Missing react dependency in client package.json');
    console.log('  ❌ Missing react dependency');
  } else {
    console.log('  ✅ Client package.json is valid');
  }
} catch (error) {
  errors.push(`Error reading package.json: ${error.message}`);
  console.log(`  ❌ Error: ${error.message}`);
}

// Check for syntax errors in JS files
console.log('\n3. Checking JavaScript syntax...');
const jsFiles = [
  'server/index.js',
  'server/database/db.js',
  'server/routes/cards.js',
  'server/routes/rfid.js',
  'server/services/rfidService.js'
];

jsFiles.forEach(file => {
  try {
    const filePath = path.join(__dirname, file);
    const content = fs.readFileSync(filePath, 'utf8');
    // Basic syntax check - try to parse as module
    new Function('require', 'module', 'exports', content);
    console.log(`  ✅ ${file}`);
  } catch (error) {
    errors.push(`Syntax error in ${file}: ${error.message}`);
    console.log(`  ❌ ${file}: ${error.message}`);
  }
});

// Summary
console.log('\n' + '='.repeat(50));
if (errors.length === 0) {
  console.log('✅ No errors found! System is ready.');
  process.exit(0);
} else {
  console.log(`❌ Found ${errors.length} error(s):\n`);
  errors.forEach((error, index) => {
    console.log(`${index + 1}. ${error}`);
  });
  process.exit(1);
}
